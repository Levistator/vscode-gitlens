export * from './config';

import {
	ConfigurationChangeEvent,
	ConfigurationScope,
	ConfigurationTarget,
	Event,
	EventEmitter,
	ExtensionContext,
	workspace,
} from 'vscode';
import { Config } from './config';
import { Objects } from './system';

const configPrefix = 'gitlens';

export interface ConfigurationWillChangeEvent {
	change: ConfigurationChangeEvent;
	transform?(e: ConfigurationChangeEvent): ConfigurationChangeEvent;
}

export class Configuration {
	static configure(context: ExtensionContext): void {
		context.subscriptions.push(
			workspace.onDidChangeConfiguration(configuration.onConfigurationChanged, configuration),
		);
	}

	private _onDidChange = new EventEmitter<ConfigurationChangeEvent>();
	get onDidChange(): Event<ConfigurationChangeEvent> {
		return this._onDidChange.event;
	}

	private _onDidChangeAny = new EventEmitter<ConfigurationChangeEvent>();
	get onDidChangeAny(): Event<ConfigurationChangeEvent> {
		return this._onDidChangeAny.event;
	}

	private _onWillChange = new EventEmitter<ConfigurationWillChangeEvent>();
	get onWillChange(): Event<ConfigurationWillChangeEvent> {
		return this._onWillChange.event;
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!e.affectsConfiguration(configPrefix)) {
			this._onDidChangeAny.fire(e);

			return;
		}

		const evt: ConfigurationWillChangeEvent = {
			change: e,
		};
		this._onWillChange.fire(evt);

		if (evt.transform !== undefined) {
			e = evt.transform(e);
		}

		this._onDidChangeAny.fire(e);
		this._onDidChange.fire(e);
	}

	get(): Config;
	get<T extends ConfigPath>(
		section: T,
		scope?: ConfigurationScope | null,
		defaultValue?: ConfigPathValue<T>,
	): ConfigPathValue<T>;
	get<T extends ConfigPath>(
		section?: T,
		scope?: ConfigurationScope | null,
		defaultValue?: ConfigPathValue<T>,
	): Config | ConfigPathValue<T> {
		return defaultValue === undefined
			? workspace
					.getConfiguration(section === undefined ? undefined : configPrefix, scope)
					.get<ConfigPathValue<T>>(section === undefined ? configPrefix : section)!
			: workspace
					.getConfiguration(section === undefined ? undefined : configPrefix, scope)
					.get<ConfigPathValue<T>>(section === undefined ? configPrefix : section, defaultValue)!;
	}

	getAny<T>(section: string, scope?: ConfigurationScope | null): T | undefined;
	getAny<T>(section: string, scope: ConfigurationScope | null | undefined, defaultValue: T): T;
	getAny<T>(section: string, scope?: ConfigurationScope | null, defaultValue?: T): T | undefined {
		return defaultValue === undefined
			? workspace.getConfiguration(undefined, scope).get<T>(section)
			: workspace.getConfiguration(undefined, scope).get<T>(section, defaultValue);
	}

	changed<T extends ConfigPath>(
		e: ConfigurationChangeEvent | undefined,
		section: T,
		scope?: ConfigurationScope | null | undefined,
	): boolean {
		return e?.affectsConfiguration(`${configPrefix}.${section}`, scope!) ?? true;
	}

	inspect<T extends ConfigPath, V extends ConfigPathValue<T>>(section: T, scope?: ConfigurationScope | null) {
		return workspace
			.getConfiguration(section === undefined ? undefined : configPrefix, scope)
			.inspect<V>(section === undefined ? configPrefix : section);
	}

	inspectAny<T>(section: string, scope?: ConfigurationScope | null) {
		return workspace.getConfiguration(undefined, scope).inspect<T>(section);
	}

	async migrate<T extends ConfigPath>(
		from: string,
		to: T,
		options: { fallbackValue?: ConfigPathValue<T>; migrationFn?(value: any): ConfigPathValue<T> },
	): Promise<boolean> {
		const inspection = configuration.inspect(from as any);
		if (inspection === undefined) return false;

		let migrated = false;
		if (inspection.globalValue !== undefined) {
			await this.update(
				to,
				options.migrationFn != null ? options.migrationFn(inspection.globalValue) : inspection.globalValue,
				ConfigurationTarget.Global,
			);
			migrated = true;
			// Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
			// if (from !== to) {
			//     try {
			//         await this.update(from, undefined, ConfigurationTarget.Global);
			//     }
			//     catch { }
			// }
		}

		if (inspection.workspaceValue !== undefined) {
			await this.update(
				to,
				options.migrationFn != null
					? options.migrationFn(inspection.workspaceValue)
					: inspection.workspaceValue,
				ConfigurationTarget.Workspace,
			);
			migrated = true;
			// Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
			// if (from !== to) {
			//     try {
			//         await this.update(from, undefined, ConfigurationTarget.Workspace);
			//     }
			//     catch { }
			// }
		}

		if (inspection.workspaceFolderValue !== undefined) {
			await this.update(
				to,
				options.migrationFn != null
					? options.migrationFn(inspection.workspaceFolderValue)
					: inspection.workspaceFolderValue,
				ConfigurationTarget.WorkspaceFolder,
			);
			migrated = true;
			// Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
			// if (from !== to) {
			//     try {
			//         await this.update(from, undefined, ConfigurationTarget.WorkspaceFolder);
			//     }
			//     catch { }
			// }
		}

		if (!migrated && options.fallbackValue !== undefined) {
			await this.update(to, options.fallbackValue, ConfigurationTarget.Global);
			migrated = true;
		}

		return migrated;
	}

	async migrateIfMissing<T extends ConfigPath>(
		from: string,
		to: T,
		options: { migrationFn?(value: any): ConfigPathValue<T> },
	): Promise<void> {
		const fromInspection = configuration.inspect(from as any);
		if (fromInspection === undefined) return;

		const toInspection = configuration.inspect(to);
		if (fromInspection.globalValue !== undefined) {
			if (toInspection === undefined || toInspection.globalValue === undefined) {
				await this.update(
					to,
					options.migrationFn != null
						? options.migrationFn(fromInspection.globalValue)
						: fromInspection.globalValue,
					ConfigurationTarget.Global,
				);
				// Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
				// if (from !== to) {
				//     try {
				//         await this.update(from, undefined, ConfigurationTarget.Global);
				//     }
				//     catch { }
				// }
			}
		}

		if (fromInspection.workspaceValue !== undefined) {
			if (toInspection === undefined || toInspection.workspaceValue === undefined) {
				await this.update(
					to,
					options.migrationFn != null
						? options.migrationFn(fromInspection.workspaceValue)
						: fromInspection.workspaceValue,
					ConfigurationTarget.Workspace,
				);
				// Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
				// if (from !== to) {
				//     try {
				//         await this.update(from, undefined, ConfigurationTarget.Workspace);
				//     }
				//     catch { }
				// }
			}
		}

		if (fromInspection.workspaceFolderValue !== undefined) {
			if (toInspection === undefined || toInspection.workspaceFolderValue === undefined) {
				await this.update(
					to,
					options.migrationFn != null
						? options.migrationFn(fromInspection.workspaceFolderValue)
						: fromInspection.workspaceFolderValue,
					ConfigurationTarget.WorkspaceFolder,
				);
				// Can't delete the old setting currently because it errors with `Unable to write to User Settings because <setting name> is not a registered configuration`
				// if (from !== to) {
				//     try {
				//         await this.update(from, undefined, ConfigurationTarget.WorkspaceFolder);
				//     }
				//     catch { }
				// }
			}
		}
	}

	name<T extends ConfigPath>(section: T): string {
		return section;
	}

	update<T extends ConfigPath>(
		section: T,
		value: ConfigPathValue<T> | undefined,
		target: ConfigurationTarget,
	): Thenable<void> {
		return workspace.getConfiguration(configPrefix).update(section, value, target);
	}

	updateAny(
		section: string,
		value: any,
		target: ConfigurationTarget,
		scope?: ConfigurationScope | null,
	): Thenable<void> {
		return workspace
			.getConfiguration(undefined, target === ConfigurationTarget.Global ? undefined : scope!)
			.update(section, value, target);
	}

	updateEffective<T extends ConfigPath>(section: T, value: ConfigPathValue<T> | undefined): Thenable<void> {
		const inspect = configuration.inspect(section)!;
		if (inspect.workspaceFolderValue !== undefined) {
			if (value === inspect.workspaceFolderValue) return Promise.resolve(undefined);

			return configuration.update(section, value, ConfigurationTarget.WorkspaceFolder);
		}

		if (inspect.workspaceValue !== undefined) {
			if (value === inspect.workspaceValue) return Promise.resolve(undefined);

			return configuration.update(section, value, ConfigurationTarget.Workspace);
		}

		if (inspect.globalValue === value || (inspect.globalValue === undefined && value === inspect.defaultValue)) {
			return Promise.resolve(undefined);
		}

		return configuration.update(
			section,
			Objects.areEqual(value, inspect.defaultValue) ? undefined : value,
			ConfigurationTarget.Global,
		);
	}
}

export const configuration = new Configuration();

type SubPath<T, Key extends keyof T> = Key extends string
	? T[Key] extends Record<string, any>
		?
				| `${Key}.${SubPath<T[Key], Exclude<keyof T[Key], keyof any[]>> & string}`
				| `${Key}.${Exclude<keyof T[Key], keyof any[]> & string}`
		: never
	: never;

type Path<T> = SubPath<T, keyof T> | keyof T;

type PathValue<T, P extends Path<T>> = P extends `${infer Key}.${infer Rest}`
	? Key extends keyof T
		? Rest extends Path<T[Key]>
			? PathValue<T[Key], Rest>
			: never
		: never
	: P extends keyof T
	? T[P]
	: never;

type ConfigPath = Path<Config>;
type ConfigPathValue<P extends ConfigPath> = PathValue<Config, P>;
