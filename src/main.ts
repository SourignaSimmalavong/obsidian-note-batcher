import {
	App,
	ButtonComponent,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";
import { getAPI } from "obsidian-dataview";
import { FolderInputSuggester } from "./settings/FolderInputSuggester";
import { DEFAULT_SETTINGS } from "./settings/settings";
import { InvalidLlinkModal } from "./modal";
import { InvalidLink, PluginSettings, RegexStrToFolder } from "./types.d";

export function arraymove<T>(
	arr: T[],
	fromIndex: number,
	toIndex: number
): void {
	if (toIndex < 0 || toIndex === arr.length) {
		return;
	}
	const element = arr[fromIndex];
	arr[fromIndex] = arr[toIndex];
	arr[toIndex] = element;
}

export interface RegexToFolder {
	regex: RegExp,
	folder: string,
}


export default class NoteBatcherPlugin extends Plugin {
	settings: PluginSettings;

	getExtension(path: string): string | undefined {
		if (path.contains(".")) {
			return path.split(".").last();
		}

		return undefined;
	}

	isDataviewEnabled(): boolean {
		return !!getAPI(this.app);
	}

	isFolderPathValid(path: string): boolean {
		return !!this.app.vault.getAbstractFileByPath(path ? path : "/");
	}

	async createFile(output_folder: string, outpath: string): Promise<boolean> {
		const validFilenameRegexp = /^(?:[^*"\\/<>:|?])+$/;

		if (!validFilenameRegexp.test(outpath)) {
			console.log(`Invalid filename: ${outpath}`);
			return false;
		}

		console.log(`Create ${output_folder}/${outpath}.md`);

		await this.app.vault
			.create(`${output_folder}/${outpath}.md`, "")
			.then((file: TFile) => { return true; })
			.catch((err) => {
				return false;
			});

		return true;
	}

	async batchCreate() {
		if (!this.isDataviewEnabled()) {
			new Notice(
				"You must install and enable the Dataview plugin first."
			);
			return;
		}

		const dv = getAPI(this.app);
		let ok = 0;
		// eslint-disable-next-line prefer-const
		let nok: InvalidLink[] = [];
		const pages: any[] = dv.pages('"' + this.settings.inputLocation + '"');

		const output_locations_reg: Array<RegexToFolder> = [];
		for (const o of this.settings.output_locations) {
			output_locations_reg.push({ regex: new RegExp(o.regex_str), folder: o.folder });
		}

		// For each page
		const linkPathPattern = "[^\\]\\[]";
		const linkPattern = `\\[\\[(${linkPathPattern}+)\\]\\]`;
		const innerLinksRegexp =
			new RegExp(`^(${linkPathPattern}+)\\]\\](?:${linkPathPattern}*${linkPattern})*${linkPathPattern}*\\[\\[(${linkPathPattern}+)$`, 'g');
		console.log("regex", innerLinksRegexp.toString());
		for (let i = 0; i < pages.length; i++) {
			const page = pages[i];
			const outlinks = page.file.outlinks.values;

			// For each outgoing link of each page
			for (let j = 0; j < outlinks.length; j++) {
				const outlink = outlinks[j];
				const fileExist = !!dv.page(outlink.path)?.files;
				const hasExtension = !!this.getExtension(outlink.path);

				// Find the first regex that match with current file path.
				let output_folder = '';
				for (const output_location of output_locations_reg) {
					if (output_location.regex.test(outlink.path)) {
						output_folder = output_location.folder;
						break;
					}
				}

				if (output_folder == '') {
					// The outlink didn't match any regex.
					continue;
				}

				if (!this.isFolderPathValid(output_folder)) {
					console.log(`Folder does not exist: ${output_folder}`);
					continue;
				}

				if (!fileExist && !hasExtension) {

					const innerLinksRegexpMatchesIter = outlink.path.matchAll(innerLinksRegexp);
					const innerLinksRegexpMatches = [...innerLinksRegexpMatchesIter];
					console.log(innerLinksRegexpMatches);
					if (innerLinksRegexpMatches.length != 0) {
						console.log("inner links: ", outlink.path);
						// Current outlink is actually several links on the same line.
						// (Possible bug in metadata menu plugin?)
						for (const innerLinks of innerLinksRegexpMatches) {
							console.log("innerLinks", innerLinks);
							for (let i = 1; i < innerLinks.length; ++i) {
								console.log(`innerLinks[${i}]`, innerLinks[i]);

								if (!await this.createFile(output_folder, innerLinks[i])) {
									// If the link has already been pushed to the array
									if (!nok.some((e) => e.to === innerLinks[i])) {
										nok.push({
											from: {
												folder: page.file.folder,
												filename: page.file.name,
											},
											to: innerLinks[i],
										});
									}
								}
							}
						}
					}
					else {
						if (!await this.createFile(output_folder, outlink.path)) {
							// If the link has already been pushed to the array
							if (!nok.some((e) => e.to === outlink.path)) {
								nok.push({
									from: {
										folder: page.file.folder,
										filename: page.file.name,
									},
									to: outlink.path,
								});
							}

						}
					}
				}
			}
		}

		new Notice(
			`Created ${ok} notes out of ${nok.length + ok} unresolved links.`
		);

		if (nok.length > 0) {
			new InvalidLlinkModal(this.app, nok).open();
		}
	}


	async onload() {
		await this.loadSettings();

		// this.addRibbonIcon(
		// 	"link",
		// 	"Create unresolved notes",
		// 	(evt: MouseEvent) => {
		// 		this.batchCreate();
		// 	}
		// );

		this.addCommand({
			id: "create-unresolved-notes",
			name: "Create unresolved notes",
			callback: () => {
				this.batchCreate();
			},
		});

		this.addSettingTab(new SettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SettingTab extends PluginSettingTab {
	plugin: NoteBatcherPlugin;

	constructor(app: App, plugin: NoteBatcherPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(this.containerEl)
			.setName("Input location")
			.setDesc(
				"Folder from where the unresolved notes will be searched for. Empty value is equivalent to the vault root."
			)
			.addSearch((cb) => {
				new FolderInputSuggester(this.app, cb.inputEl);
				cb.setPlaceholder("Example: folder1/folder2")
					.setValue(this.plugin.settings.inputLocation)
					.onChange((newFolder) => {
						this.plugin.settings.inputLocation = newFolder;
						this.plugin.saveSettings();
					});
			});

		new Setting(this.containerEl)
			.setName("Output locations (regexp)")
			.setDesc("For each note, create it in the folder of the first matching regexp (order of the regex / output locations is important).")
			.addButton((button: ButtonComponent) => {
				button
					.setTooltip("Add additional folder template")
					.setButtonText("+")
					.setCta()
					.onClick(() => {
						this.plugin.settings.output_locations.push({
							regex_str: "",
							folder: "",
						});
						this.plugin.saveSettings();
						this.display();
					});
			});

		this.plugin.settings.output_locations.forEach(
			(output_location, index) => {
				const s = new Setting(this.containerEl)
					.addText((text) => {
						text.setPlaceholder("regex")
							.setValue(
								output_location.regex_str
							)
							.onChange((new_value) => {
								try {
									new RegExp(new_value);
									output_location.regex_str = new_value;
									this.plugin.saveSettings();
								}
								catch (e) {
									console.log(`Invalid regex: ${e}`);
								}
							});
					})
					.addSearch((cb) => {
						new FolderInputSuggester(app, cb.inputEl);
						cb.setPlaceholder("Folder")
							.setValue(output_location.folder)
							.onChange((new_folder) => {
								if (
									new_folder &&
									this.plugin.settings.output_locations.some(
										(e) => e.folder == new_folder
									)
								) {
									console.log("This folder already has a template associated with it");
									return;
								}

								this.plugin.settings.output_locations[
									index
								].folder = new_folder;
								this.plugin.saveSettings();
							});
						// @ts-ignore
						cb.containerEl.addClass("templater_search");
					})
					.addExtraButton((cb) => {
						cb.setIcon("up-chevron-glyph")
							.setTooltip("Move up")
							.onClick(() => {
								arraymove(
									this.plugin.settings.output_locations,
									index,
									index - 1
								);
								this.plugin.saveSettings();
								this.display();
							});
					})
					.addExtraButton((cb) => {
						cb.setIcon("down-chevron-glyph")
							.setTooltip("Move down")
							.onClick(() => {
								arraymove(
									this.plugin.settings.output_locations,
									index,
									index + 1
								);
								this.plugin.saveSettings();
								this.display();
							});
					})
					.addExtraButton((cb) => {
						cb.setIcon("cross")
							.setTooltip("Delete")
							.onClick(() => {
								this.plugin.settings.output_locations.splice(
									index,
									1
								);
								this.plugin.saveSettings();
								this.display();
							});
					});
				s.infoEl.remove();
			}
		);

		new Setting(this.containerEl).setDesc(
			"If you use a template plugin like Templater with folder templates, the folder template will be applied."
		);
	}
}
