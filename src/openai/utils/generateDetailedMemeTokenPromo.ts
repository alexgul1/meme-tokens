import {openai} from '../index';

export async function generateDetailedMemeTokenPromo(tokenName: string): Promise<string> {
	try {
		const response = await openai.chat.completions.create({
			model: 'gpt-4o', // Ensure the model name is correct
			messages: [
				{
					role: 'system',
					content: `You are a creative crypto marketer. Based on the name of a meme token, create a short, catchy message consisting of a few sentences (max 128 symbols) for a KOL (Key Opinion Leader) channel in Telegram. This channel specializes in token calls where users can purchase tokens. The message should be unique for the token "${tokenName}", include some fictional but plausible details about the token that fit its name, and may include elements like belief in the project or a call to action to buy. Do not mention the token's price. Additionally, make it clear that these tokens are not owned by us and do not need to be mentioned in the message. Always advise users to consider risks and perform their own research (DYOR). Keep the message concise. Without hashtags`,
				},
				{
					role: 'user',
					content: `Token Name: ${tokenName}`,
				},
			],
			temperature: 0.5, // Slightly reduced for more focused output
			max_tokens: 75, // Reduced to make the message shorter
			top_p: 1,
		});

		return response?.choices[0]?.message?.content?.trim() || '';
	} catch (e) {
		console.log(e)
		return ''
	}

}
