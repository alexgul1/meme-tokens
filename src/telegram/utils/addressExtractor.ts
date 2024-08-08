export const  extractSolAddress = (message: string): string | null => {
	const solAddressPattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
	const match = message.match(solAddressPattern);
	return match ? match[0] : null;
}
