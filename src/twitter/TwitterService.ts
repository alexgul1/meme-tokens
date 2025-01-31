import axios from 'axios';
import dayjs from 'dayjs';

type TwitterMention = {
	'end': Date,
	'start': Date,
	'tweet_count': number,
}

export class TwitterService {
	private static BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAMKYvAEAAAAAIdUNCR4Qa1lAS8ZQRzA0Mn4OM0o%3D5UnNGCI1zl3aQsIyrEFhwPGIoHmNJFdyVdezfigLZWBs4p251m'; // Your Twitter API Bearer Token

	/**
	 * Формирует поисковый запрос, используя и CA, и Pump.fun ссылку.
	 */
	private static buildQuery(ca: string): string {
		// Query to filter out retweets and only include verified users
		return `(${ca} -is:retweet is:verified)`;
	}

	// Helper function to get tweet counts from Twitter API
	private static async getTweetCounts(query: string): Promise<{ data: TwitterMention[] }> {
		const url = `https://api.x.com/2/tweets/counts/recent?query=${encodeURIComponent(query)}&granularity=hour`;

		console.log('url', url);

		const response = await axios.get(url, {
			headers: {
				'Authorization': `Bearer ${TwitterService.BEARER_TOKEN}`,
				'Content-Type': 'application/json',
			},
		});

		return response.data;
	}

	/**
	 * Fetches the latest 10 tweets containing the token address.
	 */
	public static async getRecentTweets(tokenAddress: string): Promise<string> {
		const query = this.buildQuery(tokenAddress);
		const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=created_at,public_metrics`;

		try {
			const response = await axios.get(url, {
				headers: { Authorization: `Bearer ${this.BEARER_TOKEN}` },
			});

			const tweets = response.data.data;
			if (!tweets || tweets.length === 0) {
				return 'No recent tweets found.';
			}

			return tweets
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				// @ts-ignore
				.map(tweet => {
					const date = dayjs(tweet.created_at).format('HH:mm');
					return `📅 <b>${date}</b> | ❤️ ${tweet.public_metrics.like_count} 🔁 ${tweet.public_metrics.retweet_count} 💬 ${tweet.public_metrics.reply_count}\n🔗 <a href="https://x.com/i/web/status/${tweet.id}">View Tweet</a>`;
				})
				.join('\n');

		} catch (error) {
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			console.error('Error fetching recent tweets:', JSON.stringify(error.response.data));
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			return `Error fetching recent tweets: ${error?.status || 'Unknown error'}`;
		}
	}

	// Function to get token mentions in the last 3 hours
	public static async getTokenMentions(tokenAddress: string): Promise<{ result: string, tweetCount: number }> {
		const query = this.buildQuery(tokenAddress); // Query to filter out retweets and only include verified users

		try {
			const {data} = await TwitterService.getTweetCounts(query);

			const now = dayjs();

			const filteredData = data.filter((item) => {
				const endTime = dayjs(item.end);
				return endTime.isAfter(now.subtract(3, 'hour')); // фильтруем последние 3 часа
			});

			// Сортируем данные по времени конца интервала
			const sortedData = filteredData.sort((a, b) => dayjs(b.end).isBefore(dayjs(a.end)) ? -1 : 1);

			// Получаем 3 последних интервала
			const lastThree = sortedData.slice(0, 3);

			if (lastThree.length === 0) {
				return { result:'No mentions found in the last 3 hours.', tweetCount: 0 };
			}
			// Iterate over the results and format each data point for the last 3 hours

			let totalMentions = 0;

			let result = '';
			lastThree.forEach((item) => {
				const startTime = dayjs(item.start);
				const duration = now.diff(startTime, 'minute');
				const tweetCount = item.tweet_count;

				totalMentions += tweetCount;

				const timeDiff = duration < 60 ? `${duration} minute(s)` : `${Math.floor(duration / 60)} hour(s) ${duration % 60} minute(s)`;

				result += `For the last ${timeDiff}, there were ${totalMentions} mentions.\n`;
			});

			return {result, tweetCount: totalMentions};
		} catch (error) {
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			console.error('Error fetching tweet counts:', JSON.stringify(error.response.data));
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			return {result: `Error fetching mentions count. Error code: ${error?.status || 'Unknown error'}`, tweetCount: 0};
		}
	}
}
