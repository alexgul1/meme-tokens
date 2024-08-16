import {Token} from '../../mongo/types/Token';

export function isCurrentDateGreaterThanEndDate(token: Token, days: number): boolean {
	if (!token.endDate) {
		// If there is no endDate, we can't compare
		return false;
	}

	const currentDate = new Date();
	const daysLater = new Date(token.endDate.getTime() + days * 24 * 60 * 60 * 1000);

	return currentDate > daysLater;
}
