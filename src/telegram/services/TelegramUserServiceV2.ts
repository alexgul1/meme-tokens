import {Api, TelegramClient} from 'telegram';
import {StoreSession} from 'telegram/sessions';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import input from 'input';
import {NewMessage, NewMessageEvent,} from 'telegram/events';
import PeerChannel = Api.PeerChannel;
import {extractSolAddress} from '../utils/addressExtractor';

import {SubscriberService} from '../../subscriber/service/SubscriberService';
import {EditedMessage, EditedMessageEvent} from 'telegram/events/EditedMessage';

export class TelegramUserServiceV2 {
	private client: TelegramClient;
	private readonly session: StoreSession;
	private readonly apiId: number;
	private readonly apiHash: string;
	private readonly chatIds: Set<string>;

	constructor() {
		this.apiId = parseInt(process.env.TELEGRAM_API_ID as string, 10);
		this.apiHash = process.env.TELEGRAM_API_HASH as string;
		this.chatIds = new Set((process.env.TELEGRAM_CHANNELS_LIST as string).split(','))

		if (!this.apiId || !this.apiId) {
			throw new Error('Environment variables TELEGRAM_API_ID and TELEGRAM_API_HASH must be set');
		}

		if (!this.chatIds.size) {
			throw new Error('Environment variables TELEGRAM_CHANNELS_LIST must be set');
		}

		console.log('SUBSCRIBED TO', this.chatIds)


		this.session = new StoreSession('my_session')
		this.client = new TelegramClient(this.session, this.apiId, this.apiHash, {connectionRetries: 5})

	}

	public async connect(): Promise<void> {
		await this.client.start({
			phoneNumber: async () => await input.text('number ?'),
			password: async () => await input.text('password?'),
			phoneCode: async () => await input.text('Code ?'),
			onError: (err) => console.log(err),
		})
	}

	private async handleUpdates() {
		this.client.addEventHandler(this.eventHandle.bind(this), new NewMessage({}))
		this.client.addEventHandler(this.editedMessageHandle.bind(this), new EditedMessage({}))

	}

	public async start():Promise<void> {
		await this.connect();
		await this.handleUpdates()
	}

	public async eventHandle(event: NewMessageEvent) {
		const message = event.message;
		const channelId =(message?.peerId as PeerChannel)?.channelId?.toString() || ''


		if (this.chatIds.has(channelId)) {

			const extractedAddress = extractSolAddress(message.message)

			console.log('Message from subscribed channel', channelId, message.message, extractedAddress)

			if (!extractedAddress) {
				return
			}

			await SubscriberService.subscribeToToken(extractedAddress, channelId)
		}
	}

	public async editedMessageHandle(event: EditedMessageEvent) {
		const message = event.message;
		const channelId = (message?.peerId as PeerChannel)?.channelId?.toString() || ''

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
				const extractedAddress = extractSolAddress(message.message)

				console.log('Edited message from subscribed channel', channelId, message.message, extractedAddress)

				if (!extractedAddress) {
					return;
				}

				await SubscriberService.subscribeToToken(extractedAddress, `${channelId}::edited`);
			} else {
				console.log('Edit is too late to process.', originalDate, editDate);
			}
		}
	}
}
