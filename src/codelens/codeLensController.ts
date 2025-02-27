import { ConfigurationChangeEvent, Disposable, languages } from 'vscode';
import { configuration } from '../configuration';
import { ContextKeys, setContext } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import {
	DocumentBlameStateChangeEvent,
	DocumentDirtyIdleTriggerEvent,
	GitDocumentState,
} from '../trackers/gitDocumentTracker';
import { GitCodeLensProvider } from './codeLensProvider';

export class GitCodeLensController implements Disposable {
	private _canToggle: boolean = false;
	private _disposable: Disposable | undefined;
	private _provider: GitCodeLensProvider | undefined;
	private _providerDisposable: Disposable | undefined;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			container.onReady(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
		);
	}

	dispose() {
		this._providerDisposable?.dispose();
		this._disposable?.dispose();
	}

	private onReady(): void {
		this.onConfigurationChanged();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (
			configuration.changed(e, 'codeLens') ||
			configuration.changed(e, 'defaultDateFormat') ||
			configuration.changed(e, 'defaultDateSource') ||
			configuration.changed(e, 'defaultDateStyle')
		) {
			if (e != null) {
				Logger.log('CodeLens config changed; resetting CodeLens provider');
			}

			const cfg = this.container.config.codeLens;
			if (cfg.enabled && (cfg.recentChange.enabled || cfg.authors.enabled)) {
				this.ensureProvider();
			} else {
				this._providerDisposable?.dispose();
				this._provider = undefined;
			}

			this._canToggle = cfg.recentChange.enabled || cfg.authors.enabled;
			void setContext(ContextKeys.DisabledToggleCodeLens, !this._canToggle);
		}
	}

	private onBlameStateChanged(e: DocumentBlameStateChangeEvent<GitDocumentState>) {
		// Only reset if we have saved, since the CodeLens won't naturally be re-rendered
		if (this._provider === undefined || !e.blameable) return;

		Logger.log('Blame state changed; resetting CodeLens provider');
		this._provider.reset('saved');
	}

	private onDirtyIdleTriggered(e: DocumentDirtyIdleTriggerEvent<GitDocumentState>) {
		if (this._provider === undefined || !e.document.isBlameable) return;

		const maxLines = this.container.config.advanced.blame.sizeThresholdAfterEdit;
		if (maxLines > 0 && e.document.lineCount > maxLines) return;

		Logger.log('Dirty idle triggered; resetting CodeLens provider');
		this._provider.reset('idle');
	}

	toggleCodeLens() {
		if (!this._canToggle) return;

		Logger.log('toggleCodeLens()');
		if (this._provider !== undefined) {
			this._providerDisposable?.dispose();
			this._provider = undefined;

			return;
		}

		this.ensureProvider();
	}

	private ensureProvider() {
		if (this._provider !== undefined) {
			this._provider.reset();

			return;
		}

		this._providerDisposable?.dispose();

		this._provider = new GitCodeLensProvider(this.container);
		this._providerDisposable = Disposable.from(
			languages.registerCodeLensProvider(GitCodeLensProvider.selector, this._provider),
			this.container.tracker.onDidChangeBlameState(this.onBlameStateChanged, this),
			this.container.tracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this),
		);
	}
}
