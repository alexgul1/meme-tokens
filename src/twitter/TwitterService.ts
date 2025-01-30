import axios from 'axios';
import dayjs from 'dayjs';

type TwitterMention = {
	'end': Date,
	'start': Date,
	'tweet_count': number,
}

export class TwitterService {
	private static BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAMKYvAEAAAAAIdUNCR4Qa1lAS8ZQRzA0Mn4OM0o%3D5UnNGCI1zl3aQsIyrEFhwPGIoHmNJFdyVdezfigLZWBs4p251m'; // Your Twitter API Bearer Token

	// Helper function to get tweet counts from Twitter API
	private static async getTweetCounts(query: string): Promise<{ data: TwitterMention[] }> {
		const url = `https://api.x.com/2/tweets/counts/recent?query=${query}&granularity=hour`;

		console.log('url', url);

		const response = await axios.get(url, {
			headers: {
				'Authorization': `Bearer ${TwitterService.BEARER_TOKEN}`,
				'Content-Type': 'application/json',
			},
		});

		return response.data;

	}

	// Function to get token mentions in the last 3 hours
	public static async getTokenMentions(tokenAddress: string): Promise<string> {
		const query = `${tokenAddress} -filter:retweets is:verified`; // Query to filter out retweets and only include verified users


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
				return 'No mentions found in the last 3 hours.';
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

			return result;
		} catch (error) {
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			console.error('Error fetching tweet counts:', JSON.stringify(error.response.data));
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			return `Error fetching mentions count. Error code: ${error?.status || 'Unknown error'}`;
		}
	}
}
