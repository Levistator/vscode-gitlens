import { Uri } from 'vscode';
import { DocumentSchemes } from './constants';
import { isLinux } from './env/node/platform';
import { Repository } from './git/models/repository';
import { normalizePath } from './system/path';
import { UriTrie } from './system/trie';
// TODO@eamodio don't import from string here since it will break the tests because of ESM dependencies
// import { CharCode } from './string';

const slash = 47; //CharCode.Slash;

export type RepoComparisionKey = string & { __type__: 'RepoComparisionKey' };

export function asRepoComparisonKey(uri: Uri): RepoComparisionKey {
	const { path } = normalizeRepoUri(uri);
	return path as RepoComparisionKey;
}

export function normalizeRepoUri(uri: Uri): { path: string; ignoreCase: boolean } {
	let path;
	switch (uri.scheme.toLowerCase()) {
		case DocumentSchemes.File:
			path = normalizePath(uri.fsPath);
			return { path: path, ignoreCase: !isLinux };

		case DocumentSchemes.Git:
		case DocumentSchemes.GitLens:
			path = uri.path;
			if (path.charCodeAt(path.length - 1) === slash) {
				path = path.slice(1, -1);
			} else {
				path = path.slice(1);
			}
			return { path: path, ignoreCase: !isLinux };

		case DocumentSchemes.Virtual:
		case DocumentSchemes.GitHub:
			path = uri.path;
			if (path.charCodeAt(path.length - 1) === slash) {
				path = path.slice(0, -1);
			}
			return { path: uri.authority ? `${uri.authority}${path}` : path.slice(1), ignoreCase: false };

		default:
			path = uri.path;
			if (path.charCodeAt(path.length - 1) === slash) {
				path = path.slice(1, -1);
			} else {
				path = path.slice(1);
			}
			return { path: path, ignoreCase: false };
	}
}

export class Repositories {
	private readonly _trie: UriTrie<Repository>;
	private _count: number = 0;

	constructor() {
		this._trie = new UriTrie<Repository>(normalizeRepoUri);
	}

	get count(): number {
		return this._count;
	}

	add(repository: Repository): boolean {
		const added = this._trie.set(repository.uri, repository);
		if (added) {
			this._count++;
		}
		return added;
	}

	clear(): void {
		this._count = 0;
		this._trie.clear();
	}

	forEach(fn: (repository: Repository) => void, thisArg?: unknown): void {
		for (const value of this._trie.getDescendants()) {
			fn.call(thisArg, value);
		}
	}

	get(uri: Uri): Repository | undefined {
		return this._trie.get(uri);
	}

	getClosest(uri: Uri): Repository | undefined {
		return this._trie.getClosest(uri);
	}

	has(uri: Uri): boolean {
		return this._trie.has(uri);
	}

	remove(uri: Uri): boolean {
		const deleted = this._trie.delete(uri);
		if (deleted) {
			this._count--;
		}
		return deleted;
	}

	values(): IterableIterator<Repository> {
		return this._trie.getDescendants();
	}
}
