import { commands, window } from 'vscode';
import { viewsConfigKeys } from '../configuration';
import type { Container } from '../container';
import { command, Command, Commands } from './common';

enum ViewsLayout {
	GitLens = 'gitlens',
	SourceControl = 'scm',
}

export interface SetViewsLayoutCommandArgs {
	layout: ViewsLayout;
}

@command()
export class SetViewsLayoutCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.SetViewsLayout);
	}

	async execute(args?: SetViewsLayoutCommandArgs) {
		let layout = args?.layout;
		if (layout == null) {
			const pick = await window.showQuickPick(
				[
					{
						label: 'Source Control Layout',
						description: '(default)',
						detail: 'Shows all the views together on the Source Control side bar',
						layout: ViewsLayout.SourceControl,
					},
					{
						label: 'GitLens Layout',
						description: '',
						detail: 'Shows all the views together on the GitLens side bar',
						layout: ViewsLayout.GitLens,
					},
				],
				{
					placeHolder: 'Choose a GitLens views layout',
				},
			);
			if (pick == null) return;

			layout = pick.layout;
		}

		switch (layout) {
			case ViewsLayout.GitLens:
				try {
					// Because of https://github.com/microsoft/vscode/issues/105774, run the command twice which seems to fix things
					let count = 0;
					while (count++ < 2) {
						void (await commands.executeCommand('vscode.moveViews', {
							viewIds: viewsConfigKeys.map(view => `gitlens.views.${view}`),
							destinationId: 'workbench.view.extension.gitlens',
						}));
					}
				} catch {}

				break;
			case ViewsLayout.SourceControl:
				try {
					// Because of https://github.com/microsoft/vscode/issues/105774, run the command twice which seems to fix things
					let count = 0;
					while (count++ < 2) {
						void (await commands.executeCommand('vscode.moveViews', {
							viewIds: viewsConfigKeys.map(view => `gitlens.views.${view}`),
							destinationId: 'workbench.view.scm',
						}));
					}
				} catch {
					for (const view of viewsConfigKeys) {
						void (await commands.executeCommand(`gitlens.views.${view}.resetViewLocation`));
					}
				}

				break;
		}
	}
}
