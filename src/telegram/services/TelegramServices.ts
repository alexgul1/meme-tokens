import TelegramBot from 'node-telegram-bot-api';
import RaydiumSwap from '../../swap/service/RaydiumSwap';
import {telegramUserService} from "../../index";

export type MessageParams = {
	token: string;
	action: 'buy' | 'sell';
	signalLink: string;
	transactionLink: string;
	purchaseTime: number | Date;
	chartLink: string;
	isEdited: boolean
}

function formatTokenListForTelegram(tokens: Array<{ mintAddress: string, amount: number }>): string {
	return tokens
		.map(token =>
			`<b>🪙 Token:</b>
Mint Address: <code>${token.mintAddress}</code>
Balance: ${token.amount}

`
		)
		.join('');
}


export class TelegramBotService {
	private static bot: TelegramBot;
	private static groupID: string = process.env.TELEGRAM_STAT_GROUP_ID!
	private static messageThreadId: number = parseInt(process.env.TELEGRAM_STAT_MESSAGE_THREAD_ID!)
	private static PRIVATE_LINK_RE = /^https?:\/\/t\.me\/c\/(\d+)\/(\d+)(?:\?.*)?$/i;
	private static PUBLIC_LINK_RE  = /^https?:\/\/t\.me\/(?:s\/)?([^/]+)\/(\d+)(?:\?.*)?$/i;

	// Define message templates
	private static readonly PURCHASE_TEMPLATE = `
🟢<b>{token}</b> has been 📈 Bought
🔗Signal was given - <a href="{signalLink}">Signal Link</a>
{transactionLink}
📊 View the chart: <a href="{chartLink}">Chart</a> 
🕒Purchase Time: {purchaseTime}
🕑Current Time: {currentTime}
✍️Is from edited signal: {isEdited}`;

	private static readonly SALE_TEMPLATE = `
🔴<b>{token}</b> has been 📉 Sold
🔗 Signal was given - <a href="{signalLink}">Signal Link</a>
{transactionLink}
📊 View the chart: <a href="{chartLink}">Chart</a>
🕒 Purchase Time: {purchaseTime}
🕑 Current Time: {currentTime}
✍️Is from edited signal: {isEdited}`;

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
			this.bot.onText(/\/my_wallet_tokens/, this.getMyTokensOnRequest.bind(this))
			this.bot.onText(/\/get_chat_id\s+(.+)/, this.getChatId.bind(this))
			console.log('TG bot initialized')
		}
	}

	static async getChatId(msg: TelegramBot.Message, match: RegExpExecArray | null): Promise<void> {
		const replyTo = msg.chat.id;
		const link = (match?.[1] || '').trim();

		if (!link) {
			this.bot.sendMessage(replyTo, '❌ Пришли ссылку на сообщение.');
			return
		}

		try {
			let numericChatId: string | number | null = null;
			let messageId: string | null = null;

			// 1) Приватные ссылки: t.me/c/<internal_id>/<messageId>
			let m = link.match(this.PRIVATE_LINK_RE);
			if (m) {
				const [, rawId, mid] = m;
				// для приватных чатов Telegram формирует t.me/c/<internal_id>,
				// реальный chat_id = -100<internal_id>
				numericChatId = `-100${rawId}`;
				messageId = mid;
			} else {
				// 2) Публичные: t.me/<username>/<messageId> или t.me/s/<username>/<messageId>
				m = link.match(this.PUBLIC_LINK_RE);
				if (m) {
					const [, username, mid] = m;
					messageId = mid;

					// Берём числовой id через getChat.
					// ВАЖНО: Боту обычно нужно иметь доступ к чату (иногда достаточно публичности,
					// но надёжнее — добавить бота в канал/группу хотя бы как читателя).
					// Для каналов/супергрупп Telegram возвращает отрицательный id вида -100...
					numericChatId = await telegramUserService.getChannelId(username);
				}
			}

			if (!numericChatId || !messageId) {
				this.bot.sendMessage(replyTo, '❌ Невалидная или неподдерживаемая ссылка.');
				return;
			}

			this.bot.sendMessage(
				replyTo,
				`✅ Chat ID: ${numericChatId}\n🧾 Message ID: ${messageId}`
			);
		} catch (err: any) {
			// Частые причины: бот не имеет доступа к чату/каналу, чат приватный, username неверный
			this.bot.sendMessage(
				replyTo,
				`⚠️ Не удалось получить chat_id.\nПричина: ${err?.message || err}`
			);
		}
	}

	static async sendTransactionMessage(params: MessageParams): Promise<void> {
		const {token, action, signalLink, transactionLink, purchaseTime, chartLink, isEdited} = params;
		const template = action === 'buy' ? this.PURCHASE_TEMPLATE : this.SALE_TEMPLATE;

		const message = template
			.replace('{token}', token)
			.replace('{signalLink}', signalLink)
			.replace('{transactionLink}',  transactionLink
				? `💬Transaction - <a href="${transactionLink}">Transaction Link</a>`
				: '💬Transaction - no transaction ID')
			.replace('{purchaseTime}', this.formatTimestamp(new Date(purchaseTime)))
			.replace('{currentTime}', this.formatTimestamp(new Date()))
			.replace('{chartLink}', chartLink)
			.replace('{isEdited}', String(isEdited))
		;

		try {
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			await this.bot.sendMessage(this.groupID, message, {
				parse_mode: 'HTML',
				message_thread_id: this.messageThreadId
			});
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
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			await this.bot.sendMessage(this.groupID, message, {
				message_thread_id: this.messageThreadId
			});
			console.info(`Сообщение отправлено в чат: ${this.groupID}`);
		} catch (error) {
			console.error('Ошибка при отправке сообщения: ', error);
		}
	}

	private static async getMyTokensOnRequest(msg: TelegramBot.Message): Promise<void> {
		const tokensInWallet =  await RaydiumSwap.getNonZeroTokenBalances();

		if (!tokensInWallet.length) {
			await this.bot.sendMessage(this.groupID, 'No tokens find', {
				message_thread_id: msg.message_thread_id
			});
		} else {
			const formattedTokens = formatTokenListForTelegram(tokensInWallet)

			await this.bot.sendMessage(this.groupID, formattedTokens, {
				message_thread_id: msg.message_thread_id,
				parse_mode: 'HTML'
			});
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
