'use strict';

import dotenv from 'dotenv';
import {TelegramUserServiceV2} from './telegram/services/TelegramUserServiceV2';
import {SubscriberService} from './subscriber/service/SubscriberService';
import {SubscriberServiceV2} from './subscriber/service/SubscriberServiceV2';

dotenv.config();

const init = async () => {
	const telegramUserService = new TelegramUserServiceV2();

	try {
		await SubscriberServiceV2.initialization();
		await SubscriberService.initialization();
		await telegramUserService.start();

		console.log('Listening for new messages...');
	} catch (error) {
		console.error('Error:', error);
	}

}

init()
