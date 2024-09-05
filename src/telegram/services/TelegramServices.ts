import TelegramBot from 'node-telegram-bot-api';

export type MessageParams = {
	token: string;
	action: 'buy' | 'sell';
	signalLink: string;
	transactionLink: string;
	transactionStatus: boolean;
}

export class TelegramBotService {
	private static bot: TelegramBot;
	private static groupID: string = process.env.TELEGRAM_STAT_GROUP_ID!

	// Define message templates
	private static readonly PURCHASE_TEMPLATE = `
<b>{token}</b> has been 📈 Bought
Signal was given - <a href="{signalLink}">Signal Link</a>
Transaction - <a href="{transactionLink}">Transaction Link</a> and it is <b>{status}</b>
`;

	private static readonly SALE_TEMPLATE = `
<b>{token}</b> has been 📉 Sold
Signal was given - <a href="{signalLink}">Signal Link</a>
Transaction - <a href="{transactionLink}">Transaction Link</a> and it is <b>{status}</b>
`;

	private static readonly SUCCESS_STATUS = '✅ Successful';
	private static readonly FAILURE_STATUS = '❌ Failed';

	// Инициализация бота
	static initialize(): void {
		if (!this.bot) {
			this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, {polling: true});
		}
	}

	static async sendTransactionMessage(params: MessageParams): Promise<void> {
		const {token, action, signalLink, transactionLink, transactionStatus} = params;
		const status = transactionStatus ? this.SUCCESS_STATUS : this.FAILURE_STATUS;
		const template = action === 'buy' ? this.PURCHASE_TEMPLATE : this.SALE_TEMPLATE;

		const message = template
			.replace('{token}', token)
			.replace('{signalLink}', signalLink)
			.replace('{transactionLink}', transactionLink)
			.replace('{status}', status);

		try {
			await this.bot.sendMessage(this.groupID, message, {parse_mode: 'HTML'});
		} catch (error) {
			console.error('Error sending message: ', error);
		}
	}

	// Метод для отправки сообщения в группу
	static async sendMessageToGroup(message: string): Promise<void> {
		if (!this.bot) {
			console.error('Бот не инициализирован. Вызовите initialize() перед отправкой сообщения.');
			return;
		}
		try {
			await this.bot.sendMessage(this.groupID, message);
			console.info(`Сообщение отправлено в чат: ${this.groupID}`);
		} catch (error) {
			console.error('Ошибка при отправке сообщения: ', error);
		}
	}

	// Остановка бота
	static stop(): void {
		if (this.bot) {
			this.bot.stopPolling();
			console.info('Бот остановлен.');
		}
	}
}
