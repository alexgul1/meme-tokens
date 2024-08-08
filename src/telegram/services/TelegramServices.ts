import TelegramBot from 'node-telegram-bot-api';
import { ITelegramService } from '../interfaces/ITelegramService';


export class TelegramService implements ITelegramService {
	private bot: TelegramBot;
	private groupIds: Set<string>;
	private callback?: (message: string, groupId: string) => void;

	constructor() {
		const token = process.env.TELEGRAM_BOT_TOKEN as string;
		if (!token) {
			throw new Error('Environment variable TELEGRAM_BOT_TOKEN must be set');
		}
		this.bot = new TelegramBot(token, { polling: true });
		this.groupIds = new Set<string>();
	}

	public addGroup(groupId: string): void {
		this.groupIds.add(groupId);
	}

	public removeGroup(groupId: string): void {
		this.groupIds.delete(groupId);
	}

	public startListening(callback: (message: string, groupId: string) => void): void {
		this.callback = callback;
		this.bot.on('message', (msg) => {
			const chatId = msg.chat.id.toString();
			if (this.groupIds.has(chatId) && msg.text) {
				this.callback?.(msg.text, chatId);
			}
		});
	}

	public stopListening(): void {
		this.bot.stopPolling();
	}
}
