import {
	ConfigurationChangeEvent,
	Disposable,
	EndOfLine,
	Event,
	EventEmitter,
	Position,
	Range,
	TextDocument,
	TextDocumentChangeEvent,
	TextDocumentContentChangeEvent,
	TextEditor,
	TextLine,
	Uri,
	window,
	workspace,
} from 'vscode';
import { configuration } from '../configuration';
import { ContextKeys, DocumentSchemes, isActiveDocument, isTextEditor, setContext } from '../constants';
import { Container } from '../container';
import { RepositoriesChangeEvent } from '../git/gitProviderService';
import { GitUri } from '../git/gitUri';
import { RepositoryChange, RepositoryChangeComparisonMode, RepositoryChangeEvent } from '../git/models';
import { Functions, Iterables } from '../system';
import { DocumentBlameStateChangeEvent, TrackedDocument } from './trackedDocument';

export * from './trackedDocument';

export interface DocumentContentChangeEvent<T> {
	readonly editor: TextEditor;
	readonly document: TrackedDocument<T>;
	readonly contentChanges: ReadonlyArray<TextDocumentContentChangeEvent>;
}

export interface DocumentDirtyStateChangeEvent<T> {
	readonly editor: TextEditor;
	readonly document: TrackedDocument<T>;
	readonly dirty: boolean;
}

export interface DocumentDirtyIdleTriggerEvent<T> {
	readonly editor: TextEditor;
	readonly document: TrackedDocument<T>;
}

export class DocumentTracker<T> implements Disposable {
	private _onDidChangeBlameState = new EventEmitter<DocumentBlameStateChangeEvent<T>>();
	get onDidChangeBlameState(): Event<DocumentBlameStateChangeEvent<T>> {
		return this._onDidChangeBlameState.event;
	}

	private _onDidChangeContent = new EventEmitter<DocumentContentChangeEvent<T>>();
	get onDidChangeContent(): Event<DocumentContentChangeEvent<T>> {
		return this._onDidChangeContent.event;
	}

	private _onDidChangeDirtyState = new EventEmitter<DocumentDirtyStateChangeEvent<T>>();
	get onDidChangeDirtyState(): Event<DocumentDirtyStateChangeEvent<T>> {
		return this._onDidChangeDirtyState.event;
	}

	private _onDidTriggerDirtyIdle = new EventEmitter<DocumentDirtyIdleTriggerEvent<T>>();
	get onDidTriggerDirtyIdle(): Event<DocumentDirtyIdleTriggerEvent<T>> {
		return this._onDidTriggerDirtyIdle.event;
	}

	private _dirtyIdleTriggerDelay: number;
	private readonly _disposable: Disposable;
	// TODO@eamodio: replace with a trie?
	private readonly _documentMap = new Map<TextDocument | string, Promise<TrackedDocument<T>>>();

	constructor(protected readonly container: Container) {
		this._disposable = Disposable.from(
			container.onReady(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
			window.onDidChangeActiveTextEditor(this.onActiveTextEditorChanged, this),
			// window.onDidChangeVisibleTextEditors(Functions.debounce(this.onVisibleEditorsChanged, 5000), this),
			workspace.onDidChangeTextDocument(Functions.debounce(this.onTextDocumentChanged, 50), this),
			workspace.onDidCloseTextDocument(this.onTextDocumentClosed, this),
			workspace.onDidSaveTextDocument(this.onTextDocumentSaved, this),
			this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			this.container.git.onDidChangeRepository(this.onRepositoryChanged, this),
		);

		this._dirtyIdleTriggerDelay = configuration.get('advanced.blame.delayAfterEdit');
	}

	dispose() {
		this._disposable.dispose();

		void this.clear();
	}

	private onReady(): void {
		this.onConfigurationChanged();
		this.onActiveTextEditorChanged(window.activeTextEditor);
	}

	private _timer: ReturnType<typeof setTimeout> | undefined;
	private onActiveTextEditorChanged(editor: TextEditor | undefined) {
		if (editor != null && !isTextEditor(editor)) return;

		if (this._timer != null) {
			clearTimeout(this._timer);
			this._timer = undefined;
		}

		if (editor == null) {
			this._timer = setTimeout(() => {
				this._timer = undefined;

				void setContext(ContextKeys.ActiveFileStatus, undefined);
			}, 250);

			return;
		}

		const doc = this._documentMap.get(editor.document);
		if (doc != null) {
			void doc.then(
				d => d.activate(),
				() => {},
			);

			return;
		}

		// No need to activate this, as it is implicit in initialization if currently active
		void this.addCore(editor.document);
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		// Only rest the cached state if we aren't initializing
		if (
			e != null &&
			(configuration.changed(e, 'blame.ignoreWhitespace') || configuration.changed(e, 'advanced.caching.enabled'))
		) {
			this.reset('config');
		}

		if (configuration.changed(e, 'advanced.blame.delayAfterEdit')) {
			this._dirtyIdleTriggerDelay = configuration.get('advanced.blame.delayAfterEdit');
			this._dirtyIdleTriggeredDebounced = undefined;
		}
	}

	private onRepositoriesChanged(e: RepositoriesChangeEvent) {
		this.reset(
			'repository',
			e.added.length ? new Set<string>(e.added.map(r => r.path)) : undefined,
			e.removed.length ? new Set<string>(e.removed.map(r => r.path)) : undefined,
		);
	}

	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (
			e.changed(
				RepositoryChange.Index,
				RepositoryChange.Heads,
				RepositoryChange.Status,
				RepositoryChange.Unknown,
				RepositoryChangeComparisonMode.Any,
			)
		) {
			void this.reset('repository', new Set([e.repository.path]));
		}
	}

	private async onTextDocumentChanged(e: TextDocumentChangeEvent) {
		const { scheme } = e.document.uri;
		if (scheme !== DocumentSchemes.File && scheme !== DocumentSchemes.Git && scheme !== DocumentSchemes.Vsls) {
			return;
		}

		const doc = await (this._documentMap.get(e.document) ?? this.addCore(e.document));
		doc.reset('document');

		const dirty = e.document.isDirty;
		const editor = window.activeTextEditor;

		// If we have an idle tracker, either reset or cancel it
		if (this._dirtyIdleTriggeredDebounced != null) {
			if (dirty) {
				this._dirtyIdleTriggeredDebounced({ editor: editor!, document: doc });
			} else {
				this._dirtyIdleTriggeredDebounced.cancel();
			}
		}

		// Only fire change events for the active document
		if (editor?.document === e.document) {
			this._onDidChangeContent.fire({ editor: editor, document: doc, contentChanges: e.contentChanges });
		}

		if (!doc.forceDirtyStateChangeOnNextDocumentChange && doc.dirty === dirty) return;

		doc.resetForceDirtyStateChangeOnNextDocumentChange();
		doc.dirty = dirty;

		// Only fire state change events for the active document
		if (editor == null || editor.document !== e.document) return;

		this.fireDocumentDirtyStateChanged({ editor: editor, document: doc, dirty: doc.dirty });
	}

	private onTextDocumentClosed(document: TextDocument) {
		void this.remove(document);
	}

	private async onTextDocumentSaved(document: TextDocument) {
		const doc = this._documentMap.get(document);
		if (doc != null) {
			void (await doc).update({ forceBlameChange: true });

			return;
		}

		// If we are saving the active document make sure we are tracking it
		if (isActiveDocument(document)) {
			void this.addCore(document);
		}
	}

	// private onVisibleEditorsChanged(editors: TextEditor[]) {
	//     if (this._documentMap.size === 0) return;

	//     // If we have no visible editors, or no "real" visible editors reset our cache
	//     if (editors.length === 0 || editors.every(e => !isTextEditor(e))) {
	//         this.clear();
	//     }
	// }

	add(document: TextDocument): Promise<TrackedDocument<T>>;
	add(uri: Uri): Promise<TrackedDocument<T>>;
	add(documentOrId: TextDocument | Uri): Promise<TrackedDocument<T>> {
		const doc = this._add(documentOrId);
		return doc;
	}

	async clear() {
		for (const d of this._documentMap.values()) {
			(await d).dispose();
		}

		this._documentMap.clear();
	}

	get(fileName: string): Promise<TrackedDocument<T>> | undefined;
	get(document: TextDocument): Promise<TrackedDocument<T>> | undefined;
	get(uri: Uri): Promise<TrackedDocument<T>> | undefined;
	get(documentOrId: string | TextDocument | Uri): Promise<TrackedDocument<T>> | undefined {
		const doc = this._get(documentOrId);
		return doc;
	}

	async getOrAdd(document: TextDocument): Promise<TrackedDocument<T>>;
	async getOrAdd(uri: Uri): Promise<TrackedDocument<T>>;
	async getOrAdd(documentOrId: TextDocument | Uri): Promise<TrackedDocument<T>> {
		const doc = this._get(documentOrId) ?? this._add(documentOrId);
		return doc;
	}

	has(fileName: string): boolean;
	has(document: TextDocument): boolean;
	has(uri: Uri): boolean;
	has(key: string | TextDocument | Uri): boolean {
		if (typeof key === 'string' || key instanceof Uri) {
			key = GitUri.toKey(key);
		}
		return this._documentMap.has(key);
	}

	private async remove(document: TextDocument, tracked?: TrackedDocument<T>): Promise<void> {
		let promise;
		if (tracked != null) {
			promise = this._documentMap.get(document);
		}

		this._documentMap.delete(document);
		this._documentMap.delete(GitUri.toKey(document.uri));

		(tracked ?? (await promise))?.dispose();
	}

	private async _add(documentOrId: TextDocument | Uri): Promise<TrackedDocument<T>> {
		let document;
		if (GitUri.is(documentOrId)) {
			try {
				document = await workspace.openTextDocument(documentOrId.documentUri());
			} catch (ex) {
				const msg: string = ex?.toString() ?? '';
				if (msg.includes('File seems to be binary and cannot be opened as text')) {
					document = new BinaryTextDocument(documentOrId);
				} else if (
					msg.includes('File not found') ||
					msg.includes('Unable to read file') ||
					msg.includes('Unable to resolve non-existing file')
				) {
					// If we can't find the file, assume it is because the file has been renamed or deleted at some point
					document = new MissingRevisionTextDocument(documentOrId);

					// const [fileName, repoPath] = await this.container.git.findWorkingFileName(documentOrId, undefined, ref);
					// if (fileName == null) throw new Error(`Failed to add tracking for document: ${documentOrId}`);

					// documentOrId = await workspace.openTextDocument(path.resolve(repoPath!, fileName));
				} else {
					throw ex;
				}
			}
		} else if (documentOrId instanceof Uri) {
			document = await workspace.openTextDocument(documentOrId);
		} else {
			document = documentOrId;
		}

		const doc = this.addCore(document);
		return doc;
	}

	private _get(documentOrId: string | TextDocument | Uri) {
		if (GitUri.is(documentOrId)) {
			documentOrId = GitUri.toKey(documentOrId.documentUri());
		} else if (typeof documentOrId === 'string' || documentOrId instanceof Uri) {
			documentOrId = GitUri.toKey(documentOrId);
		}

		const doc = this._documentMap.get(documentOrId);
		return doc;
	}

	private async addCore(document: TextDocument): Promise<TrackedDocument<T>> {
		const key = GitUri.toKey(document.uri);

		// Always start out false, so we will fire the event if needed
		const doc = TrackedDocument.create<T>(
			document,
			key,
			false,
			{
				onDidBlameStateChange: (e: DocumentBlameStateChangeEvent<T>) => this._onDidChangeBlameState.fire(e),
			},
			this.container,
		);

		this._documentMap.set(document, doc);
		this._documentMap.set(key, doc);

		return doc;
	}

	private _dirtyIdleTriggeredDebounced:
		| Functions.Deferrable<(e: DocumentDirtyIdleTriggerEvent<T>) => void>
		| undefined;
	private _dirtyStateChangedDebounced:
		| Functions.Deferrable<(e: DocumentDirtyStateChangeEvent<T>) => void>
		| undefined;
	private fireDocumentDirtyStateChanged(e: DocumentDirtyStateChangeEvent<T>) {
		if (e.dirty) {
			queueMicrotask(() => {
				this._dirtyStateChangedDebounced?.cancel();
				if (window.activeTextEditor !== e.editor) return;

				this._onDidChangeDirtyState.fire(e);
			});

			if (this._dirtyIdleTriggerDelay > 0) {
				if (this._dirtyIdleTriggeredDebounced == null) {
					this._dirtyIdleTriggeredDebounced = Functions.debounce(
						(e: DocumentDirtyIdleTriggerEvent<T>) => {
							if (this._dirtyIdleTriggeredDebounced?.pending!()) return;

							e.document.isDirtyIdle = true;
							this._onDidTriggerDirtyIdle.fire(e);
						},
						this._dirtyIdleTriggerDelay,
						{ track: true },
					);
				}

				this._dirtyIdleTriggeredDebounced({ editor: e.editor, document: e.document });
			}

			return;
		}

		if (this._dirtyStateChangedDebounced == null) {
			this._dirtyStateChangedDebounced = Functions.debounce((e: DocumentDirtyStateChangeEvent<T>) => {
				if (window.activeTextEditor !== e.editor) return;

				this._onDidChangeDirtyState.fire(e);
			}, 250);
		}

		this._dirtyStateChangedDebounced(e);
	}

	private reset(reason: 'config' | 'repository', changedRepoPaths?: Set<string>, removedRepoPaths?: Set<string>) {
		void Promise.allSettled(
			Iterables.map(
				Iterables.filter(this._documentMap, ([key]) => typeof key === 'string'),
				async ([, promise]) => {
					const doc = await promise;
					if (removedRepoPaths?.has(doc.uri.repoPath!)) {
						void this.remove(doc.document, doc);
						return;
					}

					if (changedRepoPaths == null || changedRepoPaths.has(doc.uri.repoPath!)) {
						doc.reset(reason);
					}
				},
			),
		);
	}
}

class EmptyTextDocument implements TextDocument {
	readonly eol: EndOfLine;
	readonly fileName: string;
	readonly isClosed: boolean;
	readonly isDirty: boolean;
	readonly isUntitled: boolean;
	readonly languageId: string;
	readonly lineCount: number;
	readonly uri: Uri;
	readonly version: number;

	constructor(public readonly gitUri: GitUri) {
		this.uri = gitUri.documentUri();

		this.eol = EndOfLine.LF;
		this.fileName = this.uri.fsPath;
		this.isClosed = false;
		this.isDirty = false;
		this.isUntitled = false;
		this.languageId = '';
		this.lineCount = 0;
		this.version = 0;
	}

	getText(_range?: Range | undefined): string {
		throw new Error('Method not supported.');
	}

	getWordRangeAtPosition(_position: Position, _regex?: RegExp | undefined): Range | undefined {
		throw new Error('Method not supported.');
	}

	lineAt(line: number): TextLine;
	lineAt(position: Position): TextLine;
	lineAt(_position: any): TextLine {
		throw new Error('Method not supported.');
	}

	offsetAt(_position: Position): number {
		throw new Error('Method not supported.');
	}

	positionAt(_offset: number): Position {
		throw new Error('Method not supported.');
	}

	save(): Thenable<boolean> {
		throw new Error('Method not supported.');
	}

	validatePosition(_position: Position): Position {
		throw new Error('Method not supported.');
	}

	validateRange(_range: Range): Range {
		throw new Error('Method not supported.');
	}
}

class BinaryTextDocument extends EmptyTextDocument {}
class MissingRevisionTextDocument extends EmptyTextDocument {}
