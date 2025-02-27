import { QuickInputButton, QuickPickItem } from 'vscode';
import { Commands, GitCommandsCommand, GitCommandsCommandArgs } from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { emojify } from '../emojis';
import {
	GitBranch,
	GitContributor,
	GitLogCommit,
	GitReference,
	GitRemoteType,
	GitRevision,
	GitStashCommit,
	GitTag,
	Repository,
} from '../git/models';
import { Dates, Strings } from '../system';
import { CommandQuickPickItem, QuickPickItemOfT } from './quickPicksItems';

export class GitCommandQuickPickItem extends CommandQuickPickItem<[GitCommandsCommandArgs]> {
	constructor(label: string, args: GitCommandsCommandArgs);
	constructor(item: QuickPickItem, args: GitCommandsCommandArgs);
	constructor(labelOrItem: string | QuickPickItem, args: GitCommandsCommandArgs) {
		super(labelOrItem, Commands.GitCommands, [args], { suppressKeyPress: true });
	}

	executeSteps(pickedVia: 'menu' | 'command') {
		return GitCommandsCommand.getSteps(Container.instance, this.args![0], pickedVia);
	}
}

export interface BranchQuickPickItem extends QuickPickItemOfT<GitBranch> {
	readonly current: boolean;
	readonly ref: string;
	readonly remote: boolean;
}

export namespace BranchQuickPickItem {
	export async function create(
		branch: GitBranch,
		picked?: boolean,
		options: {
			alwaysShow?: boolean;
			buttons?: QuickInputButton[];
			checked?: boolean;
			current?: boolean | 'checkmark';
			ref?: boolean;
			status?: boolean;
			type?: boolean | 'remote';
		} = {},
	) {
		let description = '';
		if (options.type === true) {
			if (options.current === true && branch.current) {
				description = 'current branch';
			} else {
				description = 'branch';
			}
		} else if (options.type === 'remote') {
			if (branch.remote) {
				description = 'remote branch';
			}
		} else if (options.current === true && branch.current) {
			description = 'current branch';
		}

		if (options.status && !branch.remote && branch.upstream != null) {
			let arrows = GlyphChars.Dash;

			const remote = await branch.getRemote();
			if (!branch.upstream.missing) {
				if (remote != null) {
					let left;
					let right;
					for (const { type } of remote.urls) {
						if (type === GitRemoteType.Fetch) {
							left = true;

							if (right) break;
						} else if (type === GitRemoteType.Push) {
							right = true;

							if (left) break;
						}
					}

					if (left && right) {
						arrows = GlyphChars.ArrowsRightLeft;
					} else if (right) {
						arrows = GlyphChars.ArrowRight;
					} else if (left) {
						arrows = GlyphChars.ArrowLeft;
					}
				}
			} else {
				arrows = GlyphChars.Warning;
			}

			const status = `${branch.getTrackingStatus({ suffix: `${GlyphChars.Space} ` })}${arrows}${
				GlyphChars.Space
			} ${branch.upstream.name}`;
			description = `${description ? `${description}${GlyphChars.Space.repeat(2)}${status}` : status}`;
		}

		if (options.ref) {
			if (branch.sha) {
				description = description
					? `${description}${Strings.pad('$(git-commit)', 2, 2)}${GitRevision.shorten(branch.sha)}`
					: `${Strings.pad('$(git-commit)', 0, 2)}${GitRevision.shorten(branch.sha)}`;
			}

			if (branch.date !== undefined) {
				description = description
					? `${description}${Strings.pad(GlyphChars.Dot, 2, 2)}${branch.formattedDate}`
					: branch.formattedDate;
			}
		}

		const checked =
			options.checked || (options.checked == null && options.current === 'checkmark' && branch.current);
		const item: BranchQuickPickItem = {
			label: `${Strings.pad('$(git-branch)', 0, 2)}${branch.starred ? '$(star-full) ' : ''}${branch.name}${
				checked ? `${GlyphChars.Space.repeat(2)}$(check)${GlyphChars.Space}` : ''
			}`,
			description: description,
			alwaysShow: options.alwaysShow,
			buttons: options.buttons,
			picked: picked ?? branch.current,
			item: branch,
			current: branch.current,
			ref: branch.name,
			remote: branch.remote,
		};

		return item;
	}
}

export class CommitLoadMoreQuickPickItem implements QuickPickItem {
	readonly label = 'Load more';
	readonly alwaysShow = true;
}

export type CommitQuickPickItem<T extends GitLogCommit = GitLogCommit> = QuickPickItemOfT<T>;

export namespace CommitQuickPickItem {
	export function create<T extends GitLogCommit = GitLogCommit>(
		commit: T,
		picked?: boolean,
		options: { alwaysShow?: boolean; buttons?: QuickInputButton[]; compact?: boolean; icon?: boolean } = {},
	) {
		if (GitStashCommit.is(commit)) {
			const number = commit.number == null ? '' : `${commit.number}: `;

			if (options.compact) {
				const item: CommitQuickPickItem<T> = {
					label: `${options.icon ? Strings.pad('$(archive)', 0, 2) : ''}${number}${commit.getShortMessage()}`,
					description: `${commit.formattedDate}${Strings.pad(
						GlyphChars.Dot,
						2,
						2,
					)}${commit.getFormattedDiffStatus({ compact: true })}`,
					alwaysShow: options.alwaysShow,
					buttons: options.buttons,
					picked: picked,
					item: commit,
				};

				return item;
			}

			const item: CommitQuickPickItem<T> = {
				label: `${options.icon ? Strings.pad('$(archive)', 0, 2) : ''}${number}${commit.getShortMessage()}`,
				description: '',
				detail: `${GlyphChars.Space.repeat(2)}${commit.formattedDate}${Strings.pad(
					GlyphChars.Dot,
					2,
					2,
				)}${commit.getFormattedDiffStatus({ compact: true })}`,
				alwaysShow: options.alwaysShow,
				buttons: options.buttons,
				picked: picked,
				item: commit,
			};

			return item;
		}

		if (options.compact) {
			const item: CommitQuickPickItem<T> = {
				label: `${options.icon ? Strings.pad('$(git-commit)', 0, 2) : ''}${commit.getShortMessage()}`,
				description: `${commit.author}, ${commit.formattedDate}${Strings.pad('$(git-commit)', 2, 2)}${
					commit.shortSha
				}${Strings.pad(GlyphChars.Dot, 2, 2)}${commit.getFormattedDiffStatus({ compact: true })}`,
				alwaysShow: options.alwaysShow,
				buttons: options.buttons,
				picked: picked,
				item: commit,
			};
			return item;
		}

		const item: CommitQuickPickItem<T> = {
			label: `${options.icon ? Strings.pad('$(git-commit)', 0, 2) : ''}${commit.getShortMessage()}`,
			description: '',
			detail: `${GlyphChars.Space.repeat(2)}${commit.author}, ${commit.formattedDate}${Strings.pad(
				'$(git-commit)',
				2,
				2,
			)}${commit.shortSha}${Strings.pad(GlyphChars.Dot, 2, 2)}${commit.getFormattedDiffStatus({
				compact: true,
			})}`,
			alwaysShow: options.alwaysShow,
			buttons: options.buttons,
			picked: picked,
			item: commit,
		};
		return item;
	}
}

export type ContributorQuickPickItem = QuickPickItemOfT<GitContributor>;

export namespace ContributorQuickPickItem {
	export function create(
		contributor: GitContributor,
		picked?: boolean,
		options: { alwaysShow?: boolean; buttons?: QuickInputButton[] } = {},
	): ContributorQuickPickItem {
		const item: ContributorQuickPickItem = {
			label: contributor.name,
			description: contributor.email,
			alwaysShow: options.alwaysShow,
			buttons: options.buttons,
			picked: picked,
			item: contributor,
		};
		return item;
	}
}

export interface RefQuickPickItem extends QuickPickItemOfT<GitReference> {
	readonly current: boolean;
	readonly ref: string;
	readonly remote: boolean;
}

export namespace RefQuickPickItem {
	export function create(
		ref: string | GitReference,
		repoPath: string,
		picked?: boolean,
		options: { alwaysShow?: boolean; buttons?: QuickInputButton[]; icon?: boolean; ref?: boolean } = {},
	): RefQuickPickItem {
		if (ref === '') {
			return {
				label: `${options.icon ? Strings.pad('$(file-directory)', 0, 2) : ''}Working Tree`,
				description: '',
				alwaysShow: options.alwaysShow,
				buttons: options.buttons,
				picked: picked,
				item: GitReference.create(ref, repoPath, { refType: 'revision', name: 'Working Tree' }),
				current: false,
				ref: ref,
				remote: false,
			};
		}

		if (ref === 'HEAD') {
			return {
				label: `${options.icon ? Strings.pad('$(git-branch)', 0, 2) : ''}HEAD`,
				description: '',
				alwaysShow: options.alwaysShow,
				buttons: options.buttons,
				picked: picked,
				item: GitReference.create(ref, repoPath, { refType: 'revision', name: 'HEAD' }),
				current: false,
				ref: ref,
				remote: false,
			};
		}

		let gitRef;
		if (typeof ref === 'string') {
			gitRef = GitReference.create(ref, repoPath);
		} else {
			gitRef = ref;
			ref = gitRef.ref;
		}

		if (GitRevision.isRange(ref)) {
			return {
				label: `Range ${gitRef.name}`,
				description: '',
				alwaysShow: options.alwaysShow,
				buttons: options.buttons,
				picked: picked,
				item: gitRef,
				current: false,
				ref: ref,
				remote: false,
			};
		}

		const item: RefQuickPickItem = {
			label: `Commit ${gitRef.name}`,
			description: options.ref ? `$(git-commit) ${ref}` : '',
			alwaysShow: options.alwaysShow,
			buttons: options.buttons,
			picked: picked,
			item: gitRef,
			current: false,
			ref: ref,
			remote: false,
		};

		return item;
	}
}

export interface RepositoryQuickPickItem extends QuickPickItemOfT<Repository> {
	readonly repoPath: string;
}

export namespace RepositoryQuickPickItem {
	export async function create(
		repository: Repository,
		picked?: boolean,
		options: {
			alwaysShow?: boolean;
			branch?: boolean;
			buttons?: QuickInputButton[];
			fetched?: boolean;
			status?: boolean;
		} = {},
	) {
		let repoStatus;
		if (options.branch || options.status) {
			repoStatus = await repository.getStatus();
		}

		let description = '';
		if (options.branch && repoStatus != null) {
			description = repoStatus.branch;
		}

		if (options.status && repoStatus != null) {
			let workingStatus = '';
			if (repoStatus.files.length !== 0) {
				workingStatus = repoStatus.getFormattedDiffStatus({
					compact: true,
					prefix: Strings.pad(GlyphChars.Dot, 2, 2),
				});
			}

			const upstreamStatus = repoStatus.getUpstreamStatus({
				prefix: description ? `${GlyphChars.Space} ` : '',
			});

			const status = `${upstreamStatus}${workingStatus}`;
			if (status) {
				description = `${description ? `${description}${status}` : status}`;
			}
		}

		if (options.fetched) {
			const lastFetched = await repository.getLastFetched();
			if (lastFetched !== 0) {
				const fetched = `Last fetched ${Dates.getFormatter(new Date(lastFetched)).fromNow()}`;
				description = `${
					description ? `${description}${Strings.pad(GlyphChars.Dot, 2, 2)}${fetched}` : fetched
				}`;
			}
		}

		const item: RepositoryQuickPickItem = {
			label: repository.formattedName,
			description: description,
			alwaysShow: options.alwaysShow,
			buttons: options.buttons,
			picked: picked,
			item: repository,
			repoPath: repository.path,
		};

		return item;
	}
}

export interface TagQuickPickItem extends QuickPickItemOfT<GitTag> {
	readonly current: boolean;
	readonly ref: string;
	readonly remote: boolean;
}

export namespace TagQuickPickItem {
	export function create(
		tag: GitTag,
		picked?: boolean,
		options: {
			alwaysShow?: boolean;
			buttons?: QuickInputButton[];
			checked?: boolean;
			message?: boolean;
			ref?: boolean;
			type?: boolean;
		} = {},
	) {
		let description = '';
		if (options.type) {
			description = 'tag';
		}

		if (options.ref) {
			description = `${description}${Strings.pad('$(git-commit)', description ? 2 : 0, 2)}${GitRevision.shorten(
				tag.sha,
			)}`;

			description = `${description ? `${description}${Strings.pad(GlyphChars.Dot, 2, 2)}` : ''}${
				tag.formattedDate
			}`;
		}

		if (options.message) {
			const message = emojify(tag.message);
			description = description ? `${description}${Strings.pad(GlyphChars.Dot, 2, 2)}${message}` : message;
		}

		const item: TagQuickPickItem = {
			label: `${Strings.pad('$(tag)', 0, 2)}${tag.name}${
				options.checked ? `${GlyphChars.Space.repeat(2)}$(check)${GlyphChars.Space}` : ''
			}`,
			description: description,
			alwaysShow: options.alwaysShow,
			buttons: options.buttons,
			picked: picked,
			item: tag,
			current: false,
			ref: tag.name,
			remote: false,
		};

		return item;
	}
}
