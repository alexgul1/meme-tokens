/* eslint-disable */
// @ts-nocheck
import {Api, TelegramClient} from 'telegram';
import {StoreSession} from 'telegram/sessions';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import input from 'input';
import {NewMessage, NewMessageEvent,} from 'telegram/events';
import PeerChannel = Api.PeerChannel;
import {extractSolOrPairAddress} from '../utils/addressExtractor';

import {SubscriberService} from '../../subscriber/service/SubscriberService';
import {EditedMessage, EditedMessageEvent} from 'telegram/events/EditedMessage';
import long = Api.long;
import MessageEntityTextUrl = Api.MessageEntityTextUrl;
import Channel = Api.Channel;

import * as XLSX from 'xlsx';

/* load 'fs' for readFile and writeFile support */
import * as fs from 'fs';
XLSX.set_fs(fs);

// Sleep function that returns a Promise
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomInt(max: number) {
	return Math.floor(Math.random() * max);
  }

export class TelegramUserServiceV2 {
	private client: TelegramClient;
	private clientNew: TelegramClient;

	private readonly session: StoreSession;
	private readonly sessionNew: StoreSession;

	private readonly apiId: number;
	private readonly apiHash: string;
	private readonly chatIds: Set<string>;

	constructor() {
		this.apiId = parseInt(process.env.TELEGRAM_API_ID as string, 10);
		this.apiHash = process.env.TELEGRAM_API_HASH as string;
		this.apiIdNew = parseInt(process.env.NEW_TELEGRAM_API_ID as string, 10);
		this.apiHashNew = process.env.NEW_TELEGRAM_API_HASH as string;
		this.chatIds = new Set()

		if (!this.apiId || !this.apiId) {
			throw new Error('Environment variables TELEGRAM_API_ID and TELEGRAM_API_HASH must be set');
		}

		// if (!this.chatIds.size) {
		// 	throw new Error('Environment variables TELEGRAM_CHANNELS_LIST must be set');
		// }

		console.log('SUBSCRIBED TO', this.chatIds)


		this.session = new StoreSession('my_session')
		this.sessionNew = new StoreSession('my_session_new')

		this.client = new TelegramClient(this.session, this.apiId, this.apiHash, {connectionRetries: 5})
		this.clientNew = new TelegramClient(this.sessionNew, this.apiIdNew, this.apiHashNew, {connectionRetries: 5})


	}

	public async connect(): Promise<void> {
		await this.client.start({
			phoneNumber: async () => await input.text('number ?'),
			password: async () => await input.text('password?'),
			phoneCode: async () => await input.text('Code ?'),
			onError: (err) => console.log(err),
		})
	}

	public async connectNew(): Promise<void> {
		await this.clientNew.start({
			phoneNumber: async () => await input.text('number ?'),
			password: async () => await input.text('password?'),
			phoneCode: async () => await input.text('Code ?'),
			onError: (err) => console.log(err),
		})
	}

	// eslint-disable-next-line
	private async handleUpdates() {
		this.client.addEventHandler(this.eventHandle.bind(this), new NewMessage({}))
		this.client.addEventHandler(this.editedMessageHandle.bind(this), new EditedMessage({}))

	}

	private async joinChannelWithRetry( channelUsername: string, retries: number = 3): Promise<void> {
		for (let attempt = 0; attempt < retries; attempt++) {
			try {
				// Attempt to join the channel
				await this.clientNew.invoke(
					new Api.channels.JoinChannel({
						channel: channelUsername,
					})
				);
				console.log(`Successfully joined the channel: ${channelUsername}`);
				return; // Exit the function if successful
			} catch (error) {
				if (error.message.includes("A wait of")) {
					const waitTime = parseInt(error.message.match(/A wait of (\d+)/)![1], 10);
					console.log(`Flood wait error. Waiting for ${waitTime} seconds before retrying.`);
					await sleep(waitTime * 1000); // Convert seconds to milliseconds
				} else {
					console.error(`Failed to join the channel: ${error.message}`);
					return; // Exit the function on other errors
				}
			}
		}

		console.error("Max retries reached. Could not join the channel.");
	}


	private async testMessagesFromChannel() {
		const chatIds = new Set<string>('1225991487,1442000870,1158873476,2018412116,1582651667,1822520617,1655443406,1763265784,1712900374,1715502498,1816146905,1646594948,2075523106,2051083197,1377830727,1527020399,1903316574,1758611100,1593371888,1650345849,1815753629,1886985483,2177363862,1627588799,1887840067,1506439617,1676655571,1733379069,1594723240,1529480805,1522389056,1829968037,1796683207,1523523939,1725383490,1237108606,1979897812,1923532430,1696188050,1787043883,1778595696,1937478270,1584715114,1614896791,1784795040,1556094224,1902952563,1618011108,1177366431,1555597935,1627533287,2107741923,1756988830,1609073900,1973924335,1630647967,1611974309,1566073593,1662041785,2038729708,1983551042,1854608645,1998952736,1572352608,1432113297,1667198684,1831594670,1615290231,1838918343,1936584774,1496663342,1562371080,1500874400,1616418861,1695624240,1671461751,1340726459,1727004853,1581600119,1672501396,1539956400,1732329117,1988248231,1198046393,1605011371,1810124798,1863620956,1618984443,1641270416,1560066094,1873800012,1560091416,1768441299,1117736230,2140283579,1813369922,1593755161,1812094239,1410604349,1785560316,1905125715,1861507176,1523006432,1797950401,1940032927,1822983307,1789622073,1280199847,1659455616,1769975766,1415271395,1929247626,1674414708,1697697574,2043111757,1711812162,1616963546,1807506601,1870127953,1452778226,1755052940,1989363348,1598801501,1579547727,1977494876,1674129622,1164734593,1968004868,1972317343,1944891561,1914770506,1947677551,1890838504,1624019552,1553290309,1747457748,1876806594,1594390210,1451577025,2123056392'.split(','));
		const regex = /https:\/\/t\.me\/([^\/]+)\/(\d+)/;
		const targetMessages = 0; // Total messages to fetch
		const batchSize = 0; // Number of messages to fetch per request
		let totalMessagesFetched = 0;

		// Define the channel link
		const channelLink = "https://t.me/CallAnalyserSol"; // Replace with your actual link

		// Retrieve the entity using the channel link
		const channelEntity = await this.client.getEntity(channelLink);



		while (totalMessagesFetched < targetMessages) {
			for await (const message of this.client.iterMessages(channelEntity, { limit: batchSize, addOffset: totalMessagesFetched + 1000, waitTime: 1})) {
				if (message?.entities) {
					const entity = message.entities.find((entity) => entity.className === 'MessageEntityTextUrl') as MessageEntityTextUrl;

					if (entity) {
						const channelRegexResult = entity.url.match(regex);
						const channelName = channelRegexResult?.[1];

						if (channelName) {
							console.log(totalMessagesFetched, channelName);


							try {
								const newChannelEntity = await this.client.getEntity(channelName) as Channel;

								await this.joinChannelWithRetry(newChannelEntity.username!)
								chatIds.add(newChannelEntity.id.toString());
							} catch (error) {
								console.error(`Error retrieving entity for ${channelName}:`, error);
							}
						}
					}
				}

				totalMessagesFetched++;

				if (totalMessagesFetched >= targetMessages) {

					let string = '';

					chatIds.forEach(value => string += `${value},`)

					console.log("Collected Chat IDs:", string);
					return;
				}
			}
		}
		// Iterate over messages in the channel


		console.log("Finished fetching messages.");
	}
	public async start():Promise<void> {
		await this.connect();
		await this.connectNew();


		const results = await this.client.getDialogs({limit: undefined})


			// Sample filteredResult
		const filteredResult = results
			.filter((result) => result?.entity?.className === 'Channel')
			.map(channel => ({
			id: channel.entity.id.toString(),
			username: channel.entity.username,
			title: channel.entity.title,
			link: { l: { Target: `https://t.me/${channel.entity.username}` }, v: 'Telegram Link' } // Set hyperlink and display text
			}))
			.filter(({ username }) => username);

		// Create a worksheet
		const worksheet = XLSX.utils.json_to_sheet(filteredResult, {
		header: ['id', 'username', 'title', 'link'],
		});

		// Function to calculate the maximum width for each column
		const getMaxColumnWidth = (data, header) => {
		return data.reduce((acc, row) => {
		header.forEach((key, index) => {
			const value = row[key]?.v || row[key] || ''; // Handling hyperlinks or normal text
			const length = value.length;
			acc[index] = Math.max(acc[index] || 0, length);
		});
		return acc;
		}, header.map(h => h.length));
		};

		// Calculate max column width
		const maxColumnWidths = getMaxColumnWidth(filteredResult, ['id', 'username', 'title', 'link']);

		// Set worksheet column widths
		worksheet['!cols'] = maxColumnWidths.map(width => ({ wch: width + 2 })); // Adding a little extra space

		// Create a new workbook and append the worksheet
		const workbook = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(workbook, worksheet, 'Channels');

		// Save the workbook to a file
		XLSX.writeFile(workbook, 'channels.xlsx');


		await this.testMessagesFromChannel();
		await this.handleUpdates()
	}

	public async eventHandle(event: NewMessageEvent) {
		const message = event.message;
		const channelId = (message?.peerId as PeerChannel)?.channelId?.toString() || '';

		if (this.chatIds.has(channelId)) {

			const extractedData = extractSolOrPairAddress(message.message);

			if (!extractedData) {
				return;
			}

			// Depending on whether it's a token or pair address, handle it appropriately
			if (extractedData.type === 'token') {
				await SubscriberService.subscribeToToken(extractedData.address, channelId);
			} else if (extractedData.type === 'pair') {
				// Handle the pair address if needed, or treat it the same as a token address
				await SubscriberService.subscribeToPair(extractedData.address, `${channelId}::pair`); // Example: different handling
			}
		}
	}

	public async editedMessageHandle(event: EditedMessageEvent) {
		const message = event.message;
		const channelId = (message?.peerId as PeerChannel)?.channelId?.toString() || '';

		if (this.chatIds.has(channelId)) {
			const editDateTimestamp = message.editDate;
			const originalDateTimestamp = message.date;

			if (!editDateTimestamp || !originalDateTimestamp) {
				return; // Ensure both dates are present
			}

			// Convert timestamps to Date objects
			const editDate = new Date(editDateTimestamp * 1000);
			const originalDate = new Date(originalDateTimestamp * 1000);

			// Calculate the difference in milliseconds
			const timeDifferenceInMilliseconds = editDate.getTime() - originalDate.getTime();

			// Check if the difference is less than 3 minutes (180,000 milliseconds)
			if (timeDifferenceInMilliseconds < 180000) {
				const extractedData = extractSolOrPairAddress(message.message);

				if (!extractedData) {
					return;
				}

				// Handle based on whether it's a token or pair address
				if (extractedData.type === 'token') {
					await SubscriberService.subscribeToToken(extractedData.address, `${channelId}::edited`);
				} else if (extractedData.type === 'pair') {
					await SubscriberService.subscribeToPair(extractedData.address, `${channelId}::edited::pair`);
				}
			}
		}
	}
}
