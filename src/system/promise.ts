import { CancellationToken, Disposable } from 'vscode';
import { map } from './iterable';

export type PromiseOrValue<T> = Promise<T> | T;

export function any<T>(...promises: Promise<T>[]): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const errors: Error[] = [];
		let settled = false;

		for (const promise of promises) {
			// eslint-disable-next-line no-loop-func
			void (async () => {
				try {
					const result = await promise;
					if (settled) return;

					resolve(result);
					settled = true;
				} catch (ex) {
					errors.push(ex);
				} finally {
					if (!settled) {
						if (promises.length - errors.length < 1) {
							reject(new AggregateError(errors));
							settled = true;
						}
					}
				}
			})();
		}
	});
}

export class PromiseCancelledError<T extends Promise<any> = Promise<any>> extends Error {
	constructor(public readonly promise: T, message: string) {
		super(message);
	}
}

export class PromiseCancelledErrorWithId<TKey, T extends Promise<any> = Promise<any>> extends PromiseCancelledError<T> {
	constructor(public readonly id: TKey, promise: T, message: string) {
		super(promise, message);
	}
}

export function cancellable<T>(
	promise: Promise<T>,
	timeoutOrToken?: number | CancellationToken,
	options: {
		cancelMessage?: string;
		onDidCancel?(resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void): void;
	} = {},
): Promise<T> {
	if (timeoutOrToken == null) return promise;

	return new Promise((resolve, reject) => {
		let fulfilled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let disposable: Disposable | undefined;

		if (typeof timeoutOrToken === 'number') {
			timer = setTimeout(() => {
				if (typeof options.onDidCancel === 'function') {
					options.onDidCancel(resolve, reject);
				} else {
					reject(new PromiseCancelledError(promise, options.cancelMessage ?? 'TIMED OUT'));
				}
			}, timeoutOrToken);
		} else {
			disposable = timeoutOrToken.onCancellationRequested(() => {
				disposable?.dispose();
				if (fulfilled) return;

				if (typeof options.onDidCancel === 'function') {
					options.onDidCancel(resolve, reject);
				} else {
					reject(new PromiseCancelledError(promise, options.cancelMessage ?? 'CANCELLED'));
				}
			});
		}

		promise.then(
			() => {
				fulfilled = true;
				if (timer != null) {
					clearTimeout(timer);
				}
				disposable?.dispose();
				resolve(promise);
			},
			ex => {
				fulfilled = true;
				if (timer != null) {
					clearTimeout(timer);
				}
				disposable?.dispose();
				reject(ex);
			},
		);
	});
}

export function isPromise<T>(obj: PromiseLike<T> | T): obj is Promise<T> {
	return obj instanceof Promise || typeof (obj as PromiseLike<T>)?.then === 'function';
}

export function raceAll<TPromise>(
	promises: Promise<TPromise>[],
	timeout?: number,
): Promise<(TPromise | PromiseCancelledError<Promise<TPromise>>)[]>;
export function raceAll<TPromise, T>(
	promises: Map<T, Promise<TPromise>>,
	timeout?: number,
): Promise<Map<T, TPromise | PromiseCancelledErrorWithId<T, Promise<TPromise>>>>;
export function raceAll<TPromise, T>(
	ids: Iterable<T>,
	fn: (id: T) => Promise<TPromise>,
	timeout?: number,
): Promise<Map<T, TPromise | PromiseCancelledErrorWithId<T, Promise<TPromise>>>>;
export async function raceAll<TPromise, T>(
	promisesOrIds: Promise<TPromise>[] | Map<T, Promise<TPromise>> | Iterable<T>,
	timeoutOrFn?: number | ((id: T) => Promise<TPromise>),
	timeout?: number,
) {
	let promises;
	if (timeoutOrFn != null && typeof timeoutOrFn !== 'number') {
		promises = new Map(map<T, [T, Promise<TPromise>]>(promisesOrIds as Iterable<T>, id => [id, timeoutOrFn(id)]));
	} else {
		timeout = timeoutOrFn;
		promises = promisesOrIds as Promise<TPromise>[] | Map<T, Promise<TPromise>>;
	}

	if (promises instanceof Map) {
		return new Map(
			await Promise.all(
				map<[T, Promise<TPromise>], Promise<[T, TPromise | PromiseCancelledErrorWithId<T, Promise<TPromise>>]>>(
					promises.entries(),
					timeout == null
						? ([id, promise]) => promise.then(p => [id, p])
						: ([id, promise]) =>
								Promise.race([
									promise,

									new Promise<PromiseCancelledErrorWithId<T, Promise<TPromise>>>(resolve =>
										setTimeout(
											() => resolve(new PromiseCancelledErrorWithId(id, promise, 'TIMED OUT')),
											timeout,
										),
									),
								]).then(p => [id, p]),
				),
			),
		);
	}

	return Promise.all(
		timeout == null
			? promises
			: promises.map(p =>
					Promise.race([
						p,
						new Promise<PromiseCancelledError<Promise<TPromise>>>(resolve =>
							setTimeout(() => resolve(new PromiseCancelledError(p, 'TIMED OUT')), timeout),
						),
					]),
			  ),
	);
}

export class AggregateError extends Error {
	constructor(readonly errors: Error[]) {
		super(`AggregateError(${errors.length})\n${errors.map(e => `\t${String(e)}`).join('\n')}`);

		Error.captureStackTrace?.(this, AggregateError);
	}
}
