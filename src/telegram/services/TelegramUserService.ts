/*
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import fs from 'fs';
import readline from 'readline';



export class TelegramUserService {
	private client: TelegramClient;
	private session: StringSession;
	private chats: Set<number>;

	constructor() {
		const apiId = parseInt(process.env.TELEGRAM_API_ID as string, 10);
		const apiHash = process.env.TELEGRAM_API_HASH as string;
		if (!apiId || !apiHash) {
			throw new Error('Environment variables TELEGRAM_API_ID and TELEGRAM_API_HASH must be set');
		}

		const sessionFile = '_telegram_session';
		this.session = fs.existsSync(sessionFile) ? new StringSession(fs.readFileSync(sessionFile, 'utf8')) : new StringSession('');
		this.client = new TelegramClient(this.session, apiId, apiHash, {});
		this.chats = new Set<number>();
	}

	public async connect(): Promise<void> {
		await this.client.connect();
		console.log('Connected to Telegram');
	}

	public async login(): Promise<void> {
		if ((await this.session.load())) {
			console.log('Session file found. Using existing session.');
			return;
		}

		console.log('No session file found. Logging in...');

		const phoneNumber = process.env.TELEGRAM_PHONE_NUMBER as string;

		// Send code request
		await this.client.sendCode({
			apiId: parseInt(process.env.TELEGRAM_API_ID as string, 10),
			apiHash: process.env.TELEGRAM_API_HASH as string,
		}, phoneNumber);

		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});

		// Prompt for the code
		const authCode = await new Promise<string>((resolve) => {
			rl.question('Enter the code sent to your phone: ', (code) => {
				rl.close();
				resolve(code);
			});
		});

		// Sign in
		await this.client.signInUser({
			apiId: parseInt(process.env.TELEGRAM_API_ID as string, 10),
			apiHash: process.env.TELEGRAM_API_HASH as string,
		}, {
			phoneNumber,
			phoneCode: authCode
		});

		// Save session data
		if (await this.client.isUserAuthorized()) {
			fs.writeFileSync('_telegram_session', this.session.save());
			console.log('Session file saved.');
		} else {
			throw new Error('Failed to authenticate.');
		}
	}

	public addChat(chatId: number): void {
		this.chats.add(chatId);
	}

	public removeChat(chatId: number): void {
		this.chats.delete(chatId);
	}

	private async handleUpdates() {
		this.client.addEventHandler(async (update) => {
			if (update instanceof Api.UpdateNewMessage) {
				const message = update.message;
				const chatId = message.chatId;
				if (this.chats.has(chatId)) {
					console.log(`New message in chat ${chatId}: ${message.text}`);
				}
			}
		}, Api.UpdateNewMessage);
	}

	public async start(): Promise<void> {
		await this.handleUpdates();
	}

	public async disconnect(): Promise<void> {
		await this.client.disconnect();
	}
}
*/
