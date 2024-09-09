import TelegramBot from 'node-telegram-bot-api';

export type MessageParams = {
	token: string;
	action: 'buy' | 'sell';
	signalLink: string;
	transactionLink: string;
	purchaseTime: number | Date;
	chartLink: string;
}

export class TelegramBotService {
	private static bot: TelegramBot;
	private static groupID: string = process.env.TELEGRAM_STAT_GROUP_ID!

	// Define message templates
	private static readonly PURCHASE_TEMPLATE = `
🟢<b>{token}</b> has been 📈 Bought
🔗Signal was given - <a href="{signalLink}">Signal Link</a>
{transactionLink}
📊 View the chart: <a href="{chartLink}">Chart</a> 
🕒Purchase Time: {purchaseTime}
🕑 Current Time: {currentTime}`;

	private static readonly SALE_TEMPLATE = `
🔴<b>{token}</b> has been 📉 Sold
🔗 Signal was given - <a href="{signalLink}">Signal Link</a>
{transactionLink}
📊 View the chart: <a href="{chartLink}">Chart</a>
🕒 Purchase Time: {purchaseTime}
🕑 Current Time: {currentTime}`;

	/**
	 * Format the timestamp into a readable string
	 * @returns Formatted date and time string
	 * @param date
	 */
	static formatTimestamp(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');

		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
	}

	// Инициализация бота
	static initialize(): void {
		if (!this.bot) {
			this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, {polling: true});
		}
	}

	static async sendTransactionMessage(params: MessageParams): Promise<void> {
		const {token, action, signalLink, transactionLink, purchaseTime, chartLink} = params;
		const template = action === 'buy' ? this.PURCHASE_TEMPLATE : this.SALE_TEMPLATE;

		const message = template
			.replace('{token}', token)
			.replace('{signalLink}', signalLink)
			.replace('{transactionLink}',  transactionLink
				? `💬Transaction - <a href="${transactionLink}">Transaction Link</a>`
				: '💬Transaction - no transaction ID')
			.replace('{purchaseTime}', this.formatTimestamp(new Date(purchaseTime)))
			.replace('{currentTime}', this.formatTimestamp(new Date()))
			.replace('{chartLink}', chartLink);

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
