export interface ITelegramService {
	addGroup(groupId: string): void;
	removeGroup(groupId: string): void;
	startListening(callback: (message: string, groupId: string) => void): void;
	stopListening(): void;
}
