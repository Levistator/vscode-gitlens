import { commands, Range, TextDocumentShowOptions, Uri, ViewColumn } from 'vscode';
import { BuiltInCommands, GlyphChars } from '../constants';
import type { Container } from '../container';
import { GitCommit, GitRevision } from '../git/models';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { basename } from '../system/path';
import { command, Command, Commands } from './common';

export interface DiffWithCommandArgsRevision {
	sha: string;
	uri: Uri;
	title?: string;
}

export interface DiffWithCommandArgs {
	lhs: DiffWithCommandArgsRevision;
	rhs: DiffWithCommandArgsRevision;
	repoPath: string | undefined;

	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithCommand extends Command {
	static getMarkdownCommandArgs(args: DiffWithCommandArgs): string;
	static getMarkdownCommandArgs(commit: GitCommit, line?: number): string;
	static getMarkdownCommandArgs(argsOrCommit: DiffWithCommandArgs | GitCommit, line?: number): string {
		let args: DiffWithCommandArgs | GitCommit;
		if (GitCommit.is(argsOrCommit)) {
			const commit = argsOrCommit;

			if (commit.isUncommitted) {
				args = {
					repoPath: commit.repoPath,
					lhs: {
						sha: 'HEAD',
						uri: commit.uri,
					},
					rhs: {
						sha: '',
						uri: commit.uri,
					},
					line: line,
				};
			} else {
				args = {
					repoPath: commit.repoPath,
					lhs: {
						sha: commit.previousSha != null ? commit.previousSha : GitRevision.deletedOrMissing,
						uri: commit.previousUri,
					},
					rhs: {
						sha: commit.sha,
						uri: commit.uri,
					},
					line: line,
				};
			}
		} else {
			args = argsOrCommit;
		}

		return super.getMarkdownCommandArgsCore<DiffWithCommandArgs>(Commands.DiffWith, args);
	}

	constructor(private readonly container: Container) {
		super(Commands.DiffWith);
	}

	async execute(args?: DiffWithCommandArgs): Promise<any> {
		if (args?.lhs == null || args?.rhs == null) return;

		args = {
			...args,
			lhs: { ...args.lhs },
			rhs: { ...args.rhs },
			showOptions: args.showOptions == null ? undefined : { ...args.showOptions },
		};

		if (args.repoPath == null) return;

		try {
			let lhsSha = args.lhs.sha;
			let rhsSha = args.rhs.sha;

			[args.lhs.sha, args.rhs.sha] = await Promise.all([
				await this.container.git.resolveReference(args.repoPath, args.lhs.sha, args.lhs.uri, {
					timeout: 100,
				}),
				await this.container.git.resolveReference(args.repoPath, args.rhs.sha, args.rhs.uri, {
					timeout: 100,
				}),
			]);

			if (args.lhs.sha !== GitRevision.deletedOrMissing) {
				lhsSha = args.lhs.sha;
			}

			if (args.rhs.sha && args.rhs.sha !== GitRevision.deletedOrMissing) {
				// Ensure that the file still exists in this commit
				const status = await this.container.git.getFileStatusForCommit(
					args.repoPath,
					args.rhs.uri,
					args.rhs.sha,
				);
				if (status?.status === 'D') {
					args.rhs.sha = GitRevision.deletedOrMissing;
				} else {
					rhsSha = args.rhs.sha;
				}

				if (status?.status === 'A' && args.lhs.sha.endsWith('^')) {
					args.lhs.sha = GitRevision.deletedOrMissing;
				}
			}

			const [lhs, rhs] = await Promise.all([
				this.container.git.getBestRevisionUri(args.repoPath, args.lhs.uri.fsPath, args.lhs.sha),
				this.container.git.getBestRevisionUri(args.repoPath, args.rhs.uri.fsPath, args.rhs.sha),
			]);

			let rhsSuffix = GitRevision.shorten(rhsSha, { strings: { uncommitted: 'Working Tree' } });
			if (rhs == null) {
				if (GitRevision.isUncommitted(args.rhs.sha)) {
					rhsSuffix = 'deleted';
				} else if (rhsSuffix.length === 0 && args.rhs.sha === GitRevision.deletedOrMissing) {
					rhsSuffix = 'not in Working Tree';
				} else {
					rhsSuffix = `deleted${rhsSuffix.length === 0 ? '' : ` in ${rhsSuffix}`}`;
				}
			} else if (lhs == null) {
				rhsSuffix = `added${rhsSuffix.length === 0 ? '' : ` in ${rhsSuffix}`}`;
			}

			let lhsSuffix = args.lhs.sha !== GitRevision.deletedOrMissing ? GitRevision.shorten(lhsSha) : '';
			if (lhs == null && args.rhs.sha.length === 0) {
				if (rhs != null) {
					lhsSuffix = lhsSuffix.length === 0 ? '' : `not in ${lhsSuffix}`;
					rhsSuffix = '';
				} else {
					lhsSuffix = `deleted${lhsSuffix.length === 0 ? '' : ` in ${lhsSuffix}`}`;
				}
			}

			if (args.lhs.title == null && (lhs != null || lhsSuffix.length !== 0)) {
				args.lhs.title = `${basename(args.lhs.uri.fsPath)}${lhsSuffix ? ` (${lhsSuffix})` : ''}`;
			}
			if (args.rhs.title == null) {
				args.rhs.title = `${basename(args.rhs.uri.fsPath)}${rhsSuffix ? ` (${rhsSuffix})` : ''}`;
			}

			const title =
				args.lhs.title != null && args.rhs.title != null
					? `${args.lhs.title} ${GlyphChars.ArrowLeftRightLong} ${args.rhs.title}`
					: args.lhs.title ?? args.rhs.title;

			if (args.showOptions == null) {
				args.showOptions = {};
			}

			if (args.showOptions.viewColumn == null) {
				args.showOptions.viewColumn = ViewColumn.Active;
			}

			if (args.line != null && args.line !== 0) {
				args.showOptions.selection = new Range(args.line, 0, args.line, 0);
			}

			void (await commands.executeCommand(
				BuiltInCommands.Diff,
				lhs ??
					this.container.git.getRevisionUri(GitRevision.deletedOrMissing, args.lhs.uri.fsPath, args.repoPath),
				rhs ??
					this.container.git.getRevisionUri(GitRevision.deletedOrMissing, args.rhs.uri.fsPath, args.repoPath),
				title,
				args.showOptions,
			));
		} catch (ex) {
			Logger.error(ex, 'DiffWithCommand', 'getVersionedFile');
			void Messages.showGenericErrorMessage('Unable to open compare');
		}
	}
}
