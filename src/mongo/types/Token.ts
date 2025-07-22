export interface Token {
	address: string; // Pair address
	tokenAddress: string; // Token address
	labels?: string[];
	name: string; // Token name
	initialPrice: number; // Token price at start
	currentPrice: number; // Token price at this moment
	soldPrice?: string | null; // Token price on sell moment
	startDate: Date; // Date when token bought
	lastUpdateDate: Date // Date when token was last updated
	endDate?: Date | null; // Date when token sold
	parsedLink: string; // Link where this token was get
	provider: string; // Provider on which we get info
	status: 'InProgress' | 'Finished'; // Token status
	roe?: number | null; // Percent of ROE
	messageLink?: string;
	isEdited?: boolean;
}

export type TokenInfo = Omit<Token, 'initialPrice' | 'currentPrice' | 'soldPrice' | 'lastUpdateDate'| 'endDate' | 'status' | 'roe'>;
