export class Slide {
	api; item; index; id; text; html;
	constructor(api, item, index) {
		/* structure of slide objects from controller/live-items - https://gitlab.com/openlp/wiki/-/wikis/Documentation/HTTP-API#controllerlive-items-get
			chords: HTML formatted string containing chords
			footer: HTML formatted footer text for this slide
			html: HTML formatted slide with no chords
			text: Plain text slide with no chords
			selected: If this is the selected slide
			tag: The tag used to identify this verse
			title: Same as the service item title
		*/
		this.api = api; this.item = item; this.index = index; this.id = this.item.id + '|' + this.index; // format = [ItemGuid]|[slideIndexInt]
		this.text = this.api.text; this.html = this.api.html; // TODO: take verse reference off .html
	}
	// show()
	// getters (isActive, title, previous, next, type, song, scripture) - use getters for anything that changes, and any references to item (this class doesn't have control over that, so we shouldn't assume item data is static)
		get isActive() { return this.id === this.item.service.openLP.lastSlideID; } // use a getter because active slide changes, and this prevents us from having to unmark previous active and mark new active when slide changes
		get title() { return this.item.title || this.api.title; } // prefer item title, so that slide title shows item title processing. Documentation states that slide title should be the same as item title, so any changes should flow down
		// not including footer, because it should be merely a concatenated string of data available in the slide and item objects. Let consumers of this data concat for themselves, or go to slide.api for it
		get previous() { return this.item.slides[this.index - 1]; } // can't set at construction because item.slides isn't populated by .map() return until ALL new Slide() calls have completed for an item. Even if we had access to slides created before, in forward-iteration there is no way to reference the object to be created in the next iteration of .map()
		get next() { return this.item.slides[this.index + 1]; } // can't set at construction because item.slides isn't populated by .map() return until ALL new Slide() calls have completed for an item. Even if we had access to slides created before, in forward-iteration there is no way to reference the object to be created in the next iteration of .map()
		get type() { return this.item.type; }
		get song() { return this.item.song ? { ...this.item.song, tag: this.api.tag, chords: this.api.chords } : undefined; }
		get scripture() {
			if (!this.item.scripture) { return; }
			let [, slideChapter, slideVerse] = this.text.match(/^(\d+):(\d+)/) || [];
			slideChapter ??= this.previous?.scripture.slideChapter; // when a scripture is too long for OpenLP to display it on one slide, it arbitrarily breaks the text into two slides. The second slide does not start with chapter and verse, since it starts mid-verse. In cases where the slide doesn't start with chapter and verse, we should be able to assume the previous slide shows the same chapter and verse (and that it has already found values, if there is more than one break)
			slideVerse ??= this.previous?.scripture.slideVerse;
			return { ...this.item.scripture, slideChapter, slideVerse };
		}
}
export class Item {
	api = { liveItem: null, serviceItem: null }; service; slides = [];
	constructor(service, api = {}) {
		/* service/items item structure - https://gitlab.com/openlp/wiki/-/wikis/Documentation/HTTP-API#serviceitems-get
			ccli_number: CCLI number, empty string if not applicable or missing
			id: Unique service item id
			is_valid: False if a required file is missing
			notes: Notes for the service item
			plugin: The plugin that provides this service item
			selected: If this service item is currently live
			title: The service item's title
		*/
		/* controller/live-items item structure - https://gitlab.com/openlp/wiki/-/wikis/Documentation/HTTP-API#controllerlive-items-get
			audit: Array of legal information about the service item
				[<title>, <authors_all>, <copyright>, <ccli_number>]
			[] backgroundAudio: List of audio files
			[] capabilities: List of capabilities (number indexes)
			{} data: The data associated with the service item
				This can contain anything but most commonly contains these attributes
				"alternate_title", "authors", "ccli_number", "copyright", "title"
			[] footer: Footer strings, line by line
			fromPlugin: If this service item came from a plugin
			isThemeOverwritten: If this item provides it's own theme
			name: The name of the plugin that created this service item
			notes: Notes for this service item
			slides: Array of slide objects (see documentation within transformSlide for structure of slide object)
			theme: This service item's selected theme, null if missing
			title: Service item title
			type: Display type.
				"ServiceItemType.Text", "ServiceItemType.Image", "ServiceItemType.Command"

			id: is not listed in the documentation, but is present in response
		*/
		this.service = service;
		if (api.serviceItem) { this.api.serviceItem = api.serviceItem; }
		if (api.liveItem) { this.api.liveItem = api.liveItem; }
		if (api.liveItem?.slides) { this.slides = api.liveItem.slides.map((slide, idx) => new Slide(slide, this, idx)); } // service/items doesn't return slides in item data
	}
	get type() {
		const plugin = this.api.serviceItem?.plugin || this.api.liveItem?.name;
		return { songs: 'song', bibles: 'scripture' }[plugin] || plugin;
	}
	get index() { return this.service.items?.findIndex(i => i.id === this.api.liveItem?.id); }
	get id() { return this.api.liveItem?.id || this.api.serviceItem?.id; }
	get notes() { return this.api.liveItem?.notes || this.api.serviceItem?.notes; }
	get theme() { return this.api.liveItem?.theme; } // TODO: confirm serviceItem does not have theme
	get content() { return this.api.liveItem?.type; } // TODO: confirm serviceItem does not have type
	get title() { return this.api.liveItem?.title || this.api.serviceItem?.title; }
	get isActive() { return this.id === this.openLP?.item.id; }
	get previous() { return this.service[this.index - 1]; }
	get next() { return this.service[this.index - 1]; }
	get song() {
		if (this.type !== 'song') { return; }
		return {
			ccli: this.api.serviceItem?.ccli_number,
			authors: this.api.liveItem?.audit[1],
		}
	}
	get scripture() { // parsing the title is the only universal way to derive this info. Scripture info also exists in liveItem.footer (broken into chapter/verse and translation/copyright), and liveItem.data.bibles (version and copyright). But, if you wanted to get parsed info about all scriptures in the service, you can't use liveItem without selecting each item to first population that data
		if (this.type !== 'scripture') { return; }
		const titleRx = /^(\d?[A-z\s]+)\s([\d:,\s-]+)\s([A-z\s]+)\s\(([A-Z]+)\), ([^]+)/,
			[, book, verse, translation, abbreviation, copyright] = this.title.match(titleRx),
			verseRx = /^(\d+):(\d+)-?(\d+)?$/,
			[
				[, chapterStart, chapterStartVerseStart, chapterStartVerseEnd = chapterStartVerseStart],
				[, chapterEnd = chapterStart,
					chapterEndVerseStart = chapterStart !== chapterEnd ? 1 : chapterStartVerseStart,
					chapterEndVerseEnd = chapterStart !== chapterEnd ? chapterEndVerseStart : chapterStartVerseEnd
				] = []
			] = verse.split(', ').map(s => s.match(verseRx).map(v => v && parseInt(v, 10)));
		return {
			reference: book + ' ' + verse,
			chapterStart, chapterStartVerseStart, chapterStartVerseEnd,
			chapterEnd, chapterEndVerseStart, chapterEndVerseEnd,
			book, translation, abbreviation, copyright
		}
	}
}
export class Service {
	items = []; id; openLP;
	constructor(openLP, id, items) {
		this.openLP = openLP;
		this.id = id;
		this.items = items;
		Object.defineProperty(this, 'active', { get() { return this.items.find(i => i.isActive); } });
	}
	get scriptures() { return this.items.filter(i => i.$plugin === 'bible'); }
	get songs() { return this.items.filter(i => i.$plugin === 'song'); }
}
export default class OpenLP {
	#ws; #hostname; #lastFullID; #lastSlideID; #events = {}; mode;
	item; service; // NOTE: item is not stored exclusively inside service, because item can be live without being present in the service. One can put a song or scripture on the screen, in the "Live" selector, without adding to the service. So, while an item MAY be in a service (and often will be in "production") it is not necessarily so (eg. testing, impromptu changes during the service, etc)
	// static (apiPort, wsPort, getMode, fileAsJSON) - 
		static apiPort = 4316;
		static wsPort = 4317;
		static getMode(data) {
			if (data.blank) { return 'blank'; }
			if (data.display) { return 'desktop'; }
			if (data.theme) { return 'theme'; }
			return 'presentation';
		}
		static async fileAsJSON(file) {
			return new Promise(res => {
				const reader = new FileReader();
				reader.onload = _ => res(JSON.parse(reader.result.toString()).results);
				reader.readAsText(file);
			});
		}
	// private (api, newSocket, connect)
		async #api(path, post) {
			return (await (await fetch(`http://${this.#hostname}:${this.constructor.apiPort}/api/v2/${path}`)).json());
		}
		async #newSocket(uri) { return new Promise((res, rej) => {
			const ws = new WebSocket(uri);
			ws.addEventListener('open', _ => { ws.removeEventListener('error', rej); res(ws) }, { once: true });
			ws.addEventListener('error', err => { ws.removeEventListener('open', res); rej(err) }, { once: true });
		}); }
		async #connect(hostnames) {
			async function wait(ms) { return new Promise(res => setTimeout(res, ms)); }
			const [hostname, ...fallbacks] = hostnames;
			try {
				this.#ws = await this.#newSocket(`ws://${hostname}:${this.constructor.wsPort}`);
				this.#hostname = hostname;
				console.log('OpenLP: connected to ' + hostname);
			}
			catch (error) {
				console.error('OpenLP: Failed to connect to ' + hostname, error);
				if (!fallbacks.length) { await wait(5000); return await this.#connect(hostnames); }
				return this.#connect(fallbacks);
			}
		}
	constructor(hostnames) { this.#connect(hostnames).then(_ => this.#ws.addEventListener('message', evt => this.socketMessage(evt))); }
	async socketMessage(evt) {
		const data = await this.constructor.fileAsJSON(evt.data);
		/* structure of data - https://gitlab.com/openlp/wiki/-/wikis/Documentation/websockets#program-state
			counter: "Number incremented if the live display has changed"
			service: "Number incremented if the service is modified"
			slide: "Number incremented if the service is modified" - SH: this description from documentation doesn't sound right. This should be current slide index within current item
			item: "The service unique identifier for the current service item" (GUID)
			twelve: "Is using twelve hour time"
			blank: "Is display blank"
			theme: "Is display showing the theme"
			display: "Is display showing the desktop"
			version: "Version number (not sure what for, hard coded as 3 atm)""
			isSecure: "Is authentication enabled for login required HTTP API endpoints"
			chordNotation: "Notation used for chords, can be `english`, `german` or `neo-latin`"
		*/
		// console.log('OpenLP: socket message', data);
		const mode = this.constructor.getMode(data);
		if (this.mode !== mode) { this.mode = mode; this.#events.mode?.forEach(fn => fn(mode)); }

		const slideID = data.item + '|' + data.slide, fullID = data.service + '|' + slideID, dirty = {}; // markers of whether the event data has changed. Fire events after all state has been updated, so that there isn't any confusion in event handlers as to why an item change event shows something different than the accompanying slide change event - for example
		if (this.#lastFullID === fullID) { return console.log('OpenLP: websocket sent positional duplicate'); }
		this.#lastFullID = fullID;
		if (data.service && this.service?.id !== data.service) { dirty.service = this.service = new Service(this, data.service, (await this.#api('service/items')).map(serviceItem => new Item({ serviceItem }))); }
		if (data.item && this.item?.id !== data.item) { dirty.item = this.item = new Item(this.service, { liveItem: await this.#api('controller/live-items') }); }
		if (data.item && this.#lastSlideID !== slideID) { this.#lastSlideID = slideID; dirty.slide = this.item.slides.active = this.item.slides[data.slide]; }
		Object.entries(dirty).forEach(([key, val]) => this.#events[key]?.forEach(fn => fn(val)));
	}
	on(type, fn) { (this.#events[type] ??= []).push(fn); return this; }
}