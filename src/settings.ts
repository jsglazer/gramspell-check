import { App, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import { VARIANT_LABEL, type EnglishVariant } from './core/prompt';
import type GramspellPlugin from './main';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface GramspellSettings {
	/** Name of the secret in Obsidian's SecretStorage that holds the API key (never the key itself). */
	apiKeySecret: string;
	model: string;
	effort: Effort;
	checkSpelling: boolean;
	checkGrammar: boolean;
	checkFacts: boolean;
	checkScores: boolean;
	variant: EnglishVariant;
	dictionaryPath: string;
	webSearch: boolean;
	/** Domains web search must never use, one per entry. */
	blockedDomains: string[];
	autoStamp: boolean;
	/** Keep the panel and the note scrolled to the same place. */
	syncScroll: boolean;
	/** Show cards in one list per kind instead of one list in note order. */
	groupByKind: boolean;
	scoresCollapsed: boolean;
	/** Forbidden words or phrases, one per entry: `term` or `term => replacement`. */
	forbiddenWords: string[];
	colorSpelling: string;
	colorGrammar: string;
	colorFact: string;
	colorForbidden: string;
	/** Ignored-issue fingerprints per note path. */
	ignored: Record<string, string[]>;
}

export const DEFAULT_BLOCKED_DOMAINS = [
	'reddit.com',
	'quora.com',
	'pinterest.com',
	'answers.com',
	'fandom.com',
];

export const DEFAULT_SETTINGS: GramspellSettings = {
	apiKeySecret: 'anthropic-api-key',
	model: 'claude-sonnet-5-5',
	effort: 'medium',
	checkSpelling: true,
	checkGrammar: true,
	checkFacts: true,
	checkScores: true,
	variant: 'en-US',
	dictionaryPath: 'gramspell-check/Dictionary.md',
	webSearch: true,
	blockedDomains: [...DEFAULT_BLOCKED_DOMAINS],
	autoStamp: true,
	syncScroll: true,
	groupByKind: false,
	scoresCollapsed: false,
	forbiddenWords: [],
	colorSpelling: '#fff3a3',
	colorGrammar: '#e03131',
	colorFact: '#800000',
	colorForbidden: '#9c36b5',
	ignored: {},
};

const MODELS: Record<string, string> = {
	'claude-sonnet-5-5': 'Claude Sonnet 5.5 (default)',
	'claude-opus-5-5': 'Claude Opus 5.5',
	'claude-fable-5-1': 'Claude Fable 5.1',
	'claude-haiku-5-5': 'Claude Haiku 5.5',
};

const EFFORTS: Record<Effort, string> = {
	low: 'Low',
	medium: 'Medium (default)',
	high: 'High',
	xhigh: 'Extra high',
	max: 'Max',
};

export class GramspellSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: GramspellPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = async (): Promise<void> => {
			await this.plugin.saveSettings();
		};

		new Setting(containerEl)
			.setName('Anthropic API key')
			.setDesc(
				"Pick or create a secret in Obsidian's keychain. The default name matches note check, so both plugins share one key. Only the secret's name is saved in the plugin settings.",
			)
			.addComponent((el) =>
				new SecretComponent(this.app, el).setValue(s.apiKeySecret).onChange(async (value) => {
					s.apiKeySecret = value ?? '';
					await save();
				}),
			);

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Claude model used for checking and scoring.')
			.addDropdown((d) => {
				for (const [id, label] of Object.entries(MODELS)) d.addOption(id, label);
				if (!(s.model in MODELS)) d.addOption(s.model, s.model);
				d.setValue(s.model).onChange(async (value) => {
					s.model = value;
					await save();
				});
			});

		new Setting(containerEl)
			.setName('Effort')
			.setDesc('How hard the model thinks. Higher is more thorough, slower and costs more.')
			.addDropdown((d) => {
				for (const [id, label] of Object.entries(EFFORTS)) d.addOption(id, label);
				d.setValue(s.effort).onChange(async (value) => {
					s.effort = value as Effort;
					await save();
				});
			});

		new Setting(containerEl).setName('Checks').setHeading();
		const toggle = (
			name: string,
			desc: string,
			get: () => boolean,
			set: (v: boolean) => void,
		): void => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle((t) =>
					t.setValue(get()).onChange(async (v) => {
						set(v);
						await save();
					}),
				);
		};
		toggle(
			'Spelling',
			'Misspelled and wrong-in-context words.',
			() => s.checkSpelling,
			(v) => (s.checkSpelling = v),
		);
		toggle(
			'Grammar',
			'Grammar and punctuation errors.',
			() => s.checkGrammar,
			(v) => (s.checkGrammar = v),
		);
		toggle(
			'Facts',
			'Clearly wrong factual statements.',
			() => s.checkFacts,
			(v) => (s.checkFacts = v),
		);
		toggle(
			'Scores',
			'Show the Flow, clarity and reasoning scores section (1–100). Scoring never runs with a check — only when you press Score / Rescore.',
			() => s.checkScores,
			(v) => (s.checkScores = v),
		);

		new Setting(containerEl)
			.setName('English variant')
			.setDesc('Spelling and usage conventions to check against.')
			.addDropdown((d) => {
				for (const [id, label] of Object.entries(VARIANT_LABEL)) d.addOption(id, label);
				d.setValue(s.variant).onChange(async (value) => {
					s.variant = value as EnglishVariant;
					await save();
				});
			});

		new Setting(containerEl)
			.setName('Dictionary note')
			.setDesc(
				'Vault path of your personal dictionary, one word per line. These words are never flagged. Adding a word from the pane appends it here and creates the note if needed.',
			)
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_SETTINGS.dictionaryPath)
					.setValue(s.dictionaryPath)
					.onChange(async (value) => {
						s.dictionaryPath = value.trim();
						await save();
					}),
			);

		new Setting(containerEl)
			.setName('Forbidden words')
			.setDesc(
				'Words or phrases you never want in your notes, one per line. Write "word => replacement" to fix every use automatically, or "word =>" to delete it; a word on its own is reworded by Claude in context. Lines starting with # are ignored.',
			)
			.addTextArea((t) => {
				t.inputEl.rows = 6;
				// eslint-disable-next-line obsidianmd/ui/sentence-case -- example list entries, not UI prose
				t.setPlaceholder('utilize => use\nvery =>\nobviously');
				t.setValue(s.forbiddenWords.join('\n')).onChange(async (value) => {
					s.forbiddenWords = value
						.split('\n')
						.map((l) => l.trim())
						.filter(Boolean);
					await save();
				});
			});

		new Setting(containerEl).setName('Fact checking').setHeading();
		toggle(
			'Verify facts with web search',
			'Claude searches the web to confirm fact corrections, using reputable sources, and links the source on each card. Slower and costs more.',
			() => s.webSearch,
			(v) => (s.webSearch = v),
		);
		new Setting(containerEl)
			.setName('Blocked sites')
			.setDesc('Domains web search must never use, one per line.')
			.addTextArea((t) => {
				t.inputEl.rows = 5;
				t.setValue(s.blockedDomains.join('\n')).onChange(async (value) => {
					s.blockedDomains = value
						.split('\n')
						.map((d) =>
							d
								.trim()
								.replace(/^https?:\/\//, '')
								.replace(/\/.*$/, ''),
						)
						.filter(Boolean);
					await save();
				});
			});

		new Setting(containerEl).setName('Panel').setHeading();
		toggle(
			'Keep panel and note aligned',
			'Scrolling the note scrolls the panel to the issues you are looking at, and scrolling the panel scrolls the note.',
			() => s.syncScroll,
			(v) => (s.syncScroll = v),
		);
		toggle(
			'Group cards by kind',
			'Show spelling, grammar, facts and forbidden words as separate lists. Off shows one list in note order, which lines up best with the note.',
			() => s.groupByKind,
			(v) => {
				s.groupByKind = v;
				this.plugin.refreshViews();
			},
		);

		new Setting(containerEl).setName('Stamp').setHeading();
		toggle(
			'Stamp automatically',
			'Write the gramcheck date and time to the frontmatter as soon as a checked note has nothing left open.',
			() => s.autoStamp,
			(v) => (s.autoStamp = v),
		);

		new Setting(containerEl).setName('Highlight colours').setHeading();
		const color = (name: string, get: () => string, set: (v: string) => void): void => {
			new Setting(containerEl).setName(name).addColorPicker((c) =>
				c.setValue(get()).onChange(async (v) => {
					set(v);
					this.plugin.applyColors();
					await save();
				}),
			);
		};
		color(
			'Spelling background',
			() => s.colorSpelling,
			(v) => (s.colorSpelling = v),
		);
		color(
			'Grammar underline',
			() => s.colorGrammar,
			(v) => (s.colorGrammar = v),
		);
		color(
			'Fact underline',
			() => s.colorFact,
			(v) => (s.colorFact = v),
		);
		color(
			'Forbidden word underline',
			() => s.colorForbidden,
			(v) => (s.colorForbidden = v),
		);
	}
}
