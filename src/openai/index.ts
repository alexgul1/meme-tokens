import OpenAI from 'openai';

export const openai = new OpenAI({
	organization: process.env.OPENAI_ORGANIZATION,
});
