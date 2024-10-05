'use strict';

import './sentry/index';

import dotenv from 'dotenv';
import {TelegramUserServiceV2} from './telegram/services/TelegramUserServiceV2';
import * as Sentry from '@sentry/node';

import {Connection} from '@solana/web3.js';

dotenv.config();

export const SHOULD_SWAP = process.env.SHOULD_SWAP === 'true';
export const CONNECTION = new Connection(process.env.SOLANA_CONNECTION_URL || 'https://api.mainnet-beta.solana.com', {
	commitment: 'confirmed',
	wsEndpoint: process.env.WS_SOLANA_CONNECTION_URL,
});

export const JITO_CONNECTION = new Connection(process.env.JITO_CONNECTION_URL || 'https://api.mainnet-beta.solana.com', {
	commitment: 'confirmed',
});


export const telegramUserService = new TelegramUserServiceV2();

const init = async () => {
	try {
		await telegramUserService.start();


		console.log(SHOULD_SWAP)

		console.log('Listening for new messages...');
	} catch (error) {
		Sentry.captureException({message: 'Error', error});

		console.error('Error:', error);
	}

}

init()
