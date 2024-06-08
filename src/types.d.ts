export interface RegexStrToFolder {
	regex_str: string,
	folder: string,
}

export type PluginSettings = {
	inputLocation: string;
	output_locations: Array<RegexStrToFolder>;
};

export type InvalidLink = {
	from: {
		folder: string;
		filename: string;
	};
	to: string;
};
