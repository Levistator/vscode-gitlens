import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import { Arrays } from '../../system';
import { View } from '../viewBase';
import { BranchNode } from './branchNode';
import { RepositoryNode } from './repositoryNode';
import { TagNode } from './tagNode';
import { ContextValues, ViewNode } from './viewNode';

export class BranchOrTagFolderNode extends ViewNode {
	static getId(repoPath: string, key: string | undefined, type: string, relativePath: string | undefined): string {
		return `${RepositoryNode.getId(repoPath)}:${
			key === undefined ? type : `${key}:${type}`
		}-folder(${relativePath})`;
	}

	constructor(
		view: View,
		parent: ViewNode,
		public readonly type: 'branch' | 'remote-branch' | 'tag',
		public readonly repoPath: string,
		public readonly folderName: string,
		public readonly relativePath: string | undefined,
		public readonly root: Arrays.HierarchicalItem<BranchNode | TagNode>,
		private readonly _key?: string,
		private readonly _expanded: boolean = false,
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);
	}

	override toClipboard(): string {
		return this.folderName;
	}

	override get id(): string {
		return BranchOrTagFolderNode.getId(this.repoPath, this._key, this.type, this.relativePath);
	}

	getChildren(): ViewNode[] {
		if (this.root.descendants === undefined || this.root.children === undefined) return [];

		const children: (BranchOrTagFolderNode | BranchNode | TagNode)[] = [];

		for (const folder of this.root.children.values()) {
			if (folder.value === undefined) {
				// If the folder contains the current branch, expand it by default
				const expanded = folder.descendants?.some(n => n instanceof BranchNode && n.current);
				children.push(
					new BranchOrTagFolderNode(
						this.view,
						this.folderName ? this : this.parent!,
						this.type,
						this.repoPath,
						folder.name,
						folder.relativePath,
						folder,
						this._key,
						expanded,
					),
				);
				continue;
			}

			// Make sure to set the parent
			(folder.value as any).parent = this.folderName ? this : this.parent!;
			children.push(folder.value);
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			this.label,
			this._expanded ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Folder;
		item.iconPath = ThemeIcon.Folder;
		item.tooltip = this.label;
		return item;
	}

	get label(): string {
		return this.folderName;
	}
}
