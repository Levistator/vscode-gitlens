import { TextEditor, Uri } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { ActiveEditorCommand, command, Commands, executeCommand, getCommandUri } from './common';
import { OpenPullRequestOnRemoteCommandArgs } from './openPullRequestOnRemote';

@command()
export class OpenAssociatedPullRequestOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.OpenAssociatedPullRequestOnRemote);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		if (editor == null) return;

		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		const blameline = editor.selection.active.line;
		if (blameline < 0) return;

		try {
			const blame = await this.container.git.getBlameForLine(gitUri, blameline);
			if (blame == null) return;

			await executeCommand<OpenPullRequestOnRemoteCommandArgs>(Commands.OpenPullRequestOnRemote, {
				clipboard: false,
				ref: blame.commit.sha,
				repoPath: blame.commit.repoPath,
			});
		} catch (ex) {
			Logger.error(ex, 'OpenAssociatedPullRequestOnRemoteCommand', `getBlameForLine(${blameline})`);
		}
	}
}
