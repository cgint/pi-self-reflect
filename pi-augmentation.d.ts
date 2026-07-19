// Ambient augmentation for @earendil-works/pi-ai.
// Several symbols used by the extension source exist at runtime but are absent
// from the published index.d.ts shipped with this version of pi-ai. This makes
// tsc --noEmit succeed while keeping all *.ts source files byte-for-byte
// identical to the committed originals under .pi/extensions/self-reflect/.
declare module "@earendil-works/pi-ai" {
	function complete(model: any, context: any, options?: any): Promise<any>;
	function completeSimple(model: any, context: any, options?: any): Promise<any>;
	interface AssistantMessage {
		role: string;
		content: any[];
		stopReason?: string;
		provider: string;
		api: string;
		model: string;
		usage?: any;
	}
	interface Tool<TParameters = any> {
		name: string;
		description: string;
		parameters: TParameters;
	}
	export { complete, completeSimple, AssistantMessage, Tool };
}