const fs = require("fs-extra");
const axios = require("axios");

const MAX_SIZE = 25 * 1024 * 1024;

module.exports = {
	config: {
		name: "sing",
		aliases: [],
		version: "2.3",
		author: "Neoaz 🐊",
		countDown: 5,
		role: 0,
		description: {
			en: "Search a song and send it or pick from a list using -c"
		},
		category: "media",
		guide: {
			en: "   {pn} <song name>: find and send the best-matching song"
				+ "\n   {pn} <song name> -c <number>: return multiple results, reply to pick one"
		}
	},

	langs: {
		en: {
			syntaxError: "⚠️ Please enter the song name to search for",
			notFound: "❌ No song matched \"%1\"",
			noSource: "❌ This song has no downloadable source",
			tooLarge: "⚠️ The song is too large to send (%1MB > 25MB)",
			error: "❌ An error occurred: %1"
		}
	},

	onStart: async function ({ api, args, event, message, getLang }) {
		const { query, count, isCountMode } = parseArgs(args);
		if (!query) {
			await react(api, event, "❌");
			return message.reply(getLang("syntaxError"));
		}

		await react(api, event, "⏳");

		if (isCountMode) {
			try {
				const res = await api.searchMusic(query, { limit: count }).catch(() => null);
				const tracks = extractTracks(res);
				if (!tracks.length) {
					await react(api, event, "❌");
					return message.reply(getLang("notFound", query));
				}

				const list = tracks.map((t, i) => `${i + 1}. ${t.title} — ${t.artist || t.display_artist || "Unknown"}`).join("\n");

				const sent = await message.reply({
					body: list
				});
				global.GoatBot.onReply.set(sent.messageID, {
					commandName: this.config.name,
					messageID: sent.messageID,
					author: event.senderID,
					result: tracks
				});
				await react(api, event, "✅");
				return;
			}
			catch (err) {
				await react(api, event, "❌");
				return message.reply(getLang("error", err.message || JSON.stringify(err)));
			}
		}

		const res = await api.searchMusic(query).catch(() => null);
		const track = pickTrack(res, query);
		if (!track) {
			await react(api, event, "❌");
			return message.reply(getLang("notFound", query));
		}

		await sendTrack(api, event, message, track, getLang);
	},

	onReply: async function ({ message, event, api, Reply, getLang }) {
		const choice = parseInt(event.body);
		if (isNaN(choice) || choice < 1 || choice > Reply.result.length) {
			try { api.unsendMessage(Reply.messageID); } catch (e) {}
			return;
		}
		await react(api, event, "⏳");
		try {
			const track = Reply.result[choice - 1];
			try { api.unsendMessage(Reply.messageID); } catch (e) {}
			await sendTrack(api, event, message, track, getLang);
		}
		catch (err) {
			await react(api, event, "❌");
			return message.reply(getLang("error", err.message || JSON.stringify(err)));
		}
	}
};

async function sendTrack(api, event, message, track, getLang) {
	const url = track.progressive_download_url
		|| track.fast_start_progressive_download_url
		|| track.web_30s_preview_download_url
		|| track.previewUrl
		|| track.url;

	if (!url) {
		await react(api, event, "❌");
		return message.reply(getLang("noSource"));
	}

	const savePath = `${__dirname}/tmp/${Date.now()}_${event.senderID}.m4a`;

	try {
		const { data, headers } = await axios({
			url,
			method: "GET",
			responseType: "stream",
			headers: { Range: "bytes=0-" }
		});
		const size = Number(headers["content-length"] || 0);
		if (size && size > MAX_SIZE) {
			await react(api, event, "❌");
			return message.reply(getLang("tooLarge", (size / 1024 / 1024).toFixed(2)));
		}

		await fs.ensureDir(`${__dirname}/tmp`);
		const ws = fs.createWriteStream(savePath);
		await new Promise((resolve, reject) => {
			data.pipe(ws);
			ws.on("finish", resolve);
			ws.on("error", reject);
			data.on("error", reject);
		});

		const statsSize = fs.statSync(savePath).size;
		if (statsSize > MAX_SIZE) {
			await react(api, event, "❌");
			return message.reply(getLang("tooLarge", (statsSize / 1024 / 1024).toFixed(2)));
		}

		const stream = fs.createReadStream(savePath);
		stream.path = savePath;
		await new Promise((resolve, reject) => {
			api.sendMessage(
				{ body: `${track.title} — ${track.artist || track.display_artist || ""}`, attachment: stream },
				event.threadID,
				(err) => err ? reject(err) : resolve(),
				event.messageID
			);
		});
		await react(api, event, "✅");
	}
	catch (err) {
		await react(api, event, "❌");
		return message.reply(getLang("error", err.error || err.message || JSON.stringify(err)));
	}
	finally {
		fs.remove(savePath).catch(() => {});
	}
}

function extractTracks(res) {
	if (!res) return [];
	const items = res.items || (Array.isArray(res) ? res : res.tracks) || [];
	return items
		.map(item => (item && (item.track || item.original_sound || item)) || null)
		.filter(t => t && (t.audio_asset_id || t.audio_cluster_id || t.id || t.progressive_download_url || t.previewUrl));
}

function pickTrack(res, query) {
	const tracks = extractTracks(res);
	if (!tracks.length) return null;

	const nq = norm(query);
	const tokens = String(query).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
	let best = tracks[0];
	let bestScore = -1;
	for (const t of tracks) {
		const title = norm(t.title || t.canonical_title);
		let score = 0;
		if (title === nq) score += 100;
		else if (nq && title.indexOf(nq) !== -1) score += 50;
		for (const token of tokens)
			if (title.indexOf(token) !== -1) score += 1;
		if (score > bestScore) {
			bestScore = score;
			best = t;
		}
	}
	return best;
}

function parseArgs(args) {
	let count = 6;
	let isCountMode = false;
	const words = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "-c" || arg === "--count") {
			isCountMode = true;
			const value = parseInt(args[i + 1]);
			if (value > 0) count = Math.min(value, 20);
			i++;
		}
		else if (/^-c\d+$/.test(arg)) {
			isCountMode = true;
			const value = parseInt(arg.slice(2));
			if (value > 0) count = Math.min(value, 20);
		}
		else {
			words.push(arg);
		}
	}
	return { query: words.join(" ").trim(), count, isCountMode };
}

function norm(str) {
	return String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function react(api, event, emoji) {
	try {
		await api.setMessageReaction(emoji, event.messageID, event.threadID);
	}
	catch (e) {}
}
