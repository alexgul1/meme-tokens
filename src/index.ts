'use strict';

import './sentry/index';

import dotenv from 'dotenv';
import {TelegramUserServiceV2} from './telegram/services/TelegramUserServiceV2';
import {SubscriberServiceV2} from './subscriber/service/SubscriberServiceV2';
import * as Sentry from '@sentry/node';

dotenv.config();

const init = async () => {
	const telegramUserService = new TelegramUserServiceV2();

	try {
		await SubscriberServiceV2.initialization();
		await telegramUserService.start();

		console.log('Listening for new messages...');
	} catch (error) {
		Sentry.captureException({message: 'Error', error});

		console.error('Error:', error);
	}

}

init()
