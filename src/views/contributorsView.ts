import {
	CancellationToken,
	commands,
	ConfigurationChangeEvent,
	Disposable,
	ProgressLocation,
	TreeItem,
	TreeItemCollapsibleState,
	window,
} from 'vscode';
import { Avatars } from '../avatars';
import { configuration, ContributorsViewConfig, ViewFilesLayout } from '../configuration';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { GitContributor, RepositoryChange, RepositoryChangeComparisonMode, RepositoryChangeEvent } from '../git/models';
import { gate } from '../system/decorators/gate';
import { debug } from '../system/decorators/log';
import {
	ContributorNode,
	ContributorsNode,
	RepositoriesSubscribeableNode,
	RepositoryFolderNode,
	RepositoryNode,
	ViewNode,
} from './nodes';
import { ViewBase } from './viewBase';

export class ContributorsRepositoryNode extends RepositoryFolderNode<ContributorsView, ContributorsNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			this.child = new ContributorsNode(this.uri, this.view, this, this.repo);
		}

		return this.child.getChildren();
	}

	@debug()
	protected override async subscribe() {
		return Disposable.from(
			await super.subscribe(),
			Avatars.onDidFetch(e => this.child?.updateAvatar(e.email)),
		);
	}

	protected changed(e: RepositoryChangeEvent) {
		return e.changed(
			RepositoryChange.Config,
			RepositoryChange.Heads,
			RepositoryChange.Remotes,
			RepositoryChange.Unknown,
			RepositoryChangeComparisonMode.Any,
		);
	}
}

export class ContributorsViewNode extends RepositoriesSubscribeableNode<ContributorsView, ContributorsRepositoryNode> {
	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const repositories = this.view.container.git.openRepositories;
			if (repositories.length === 0) {
				this.view.message = 'No contributors could be found.';

				return [];
			}

			this.view.message = undefined;

			const splat = repositories.length === 1;
			this.children = repositories.map(
				r => new ContributorsRepositoryNode(GitUri.fromRepoPath(r.path), this.view, this, r, splat),
			);
		}

		if (this.children.length === 1) {
			const [child] = this.children;

			const children = await child.getChildren();

			// const all = this.view.container.config.views.contributors.showAllBranches;

			// let ref: string | undefined;
			// // If we aren't getting all branches, get the upstream of the current branch if there is one
			// if (!all) {
			// 	try {
			// 		const branch = await this.view.container.git.getBranch(this.uri.repoPath);
			// 		if (branch?.upstream?.name != null && !branch.upstream.missing) {
			// 			ref = '@{u}';
			// 		}
			// 	} catch {}
			// }

			// const contributors = await child.repo.getContributors({ all: all, ref: ref });
			if (children.length === 0) {
				this.view.message = 'No contributors could be found.';
				this.view.title = 'Contributors';

				void child.ensureSubscription();

				return [];
			}

			this.view.message = undefined;
			this.view.title = `Contributors (${children.length})`;

			return children;
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Contributors', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class ContributorsView extends ViewBase<ContributorsViewNode, ContributorsViewConfig> {
	protected readonly configKey = 'contributors';

	constructor(container: Container) {
		super('gitlens.views.contributors', 'Contributors', container);
	}

	override get canReveal(): boolean {
		return this.config.reveal || !configuration.get('views.repositories.showContributors');
	}

	protected getRoot() {
		return new ContributorsViewNode(this);
	}

	protected registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			commands.registerCommand(
				this.getQualifiedCommand('copy'),
				() => commands.executeCommand('gitlens.views.copy', this.selection),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('refresh'),
				() => {
					this.container.git.resetCaches('contributors');
					return this.refresh(true);
				},
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setFilesLayoutToAuto'),
				() => this.setFilesLayout(ViewFilesLayout.Auto),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setFilesLayoutToList'),
				() => this.setFilesLayout(ViewFilesLayout.List),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setFilesLayoutToTree'),
				() => this.setFilesLayout(ViewFilesLayout.Tree),
				this,
			),

			commands.registerCommand(
				this.getQualifiedCommand('setShowAllBranchesOn'),
				() => this.setShowAllBranches(true),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setShowAllBranchesOff'),
				() => this.setShowAllBranches(false),
				this,
			),

			commands.registerCommand(
				this.getQualifiedCommand('setShowAvatarsOn'),
				() => this.setShowAvatars(true),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setShowAvatarsOff'),
				() => this.setShowAvatars(false),
				this,
			),

			commands.registerCommand(
				this.getQualifiedCommand('setShowStatisticsOn'),
				() => this.setShowStatistics(true),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setShowStatisticsOff'),
				() => this.setShowStatistics(false),
				this,
			),
		];
	}

	protected override filterConfigurationChanged(e: ConfigurationChangeEvent) {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateShortFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'defaultTimeFormat') &&
			!configuration.changed(e, 'sortContributorsBy')
		) {
			return false;
		}

		return true;
	}

	findContributor(contributor: GitContributor, token?: CancellationToken) {
		const repoNodeId = RepositoryNode.getId(contributor.repoPath);

		return this.findNode(ContributorNode.getId(contributor.repoPath, contributor.name, contributor.email), {
			maxDepth: 2,
			canTraverse: n => {
				if (n instanceof ContributorsViewNode) return true;

				if (n instanceof ContributorsRepositoryNode) {
					return n.id.startsWith(repoNodeId);
				}

				return false;
			},
			token: token,
		});
	}

	@gate(() => '')
	async revealRepository(
		repoPath: string,
		options?: { select?: boolean; focus?: boolean; expand?: boolean | number },
	) {
		const node = await this.findNode(RepositoryFolderNode.getId(repoPath), {
			maxDepth: 1,
			canTraverse: n => n instanceof ContributorsViewNode || n instanceof RepositoryFolderNode,
		});

		if (node !== undefined) {
			await this.reveal(node, options);
		}

		return node;
	}

	@gate(() => '')
	async revealContributor(
		contributor: GitContributor,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Revealing contributor '${contributor.name}' in the side bar...`,
				cancellable: true,
			},
			async (progress, token) => {
				const node = await this.findContributor(contributor, token);
				if (node == null) return undefined;

				await this.ensureRevealNode(node, options);

				return node;
			},
		);
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
	}

	private setShowAllBranches(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.showAllBranches` as const, enabled);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}

	private setShowStatistics(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.showStatistics` as const, enabled);
	}
}
