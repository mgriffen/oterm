import {
	DEFAULT_FONT_FAMILY,
	DEFAULT_FONT_SIZE,
	DEFAULT_SCROLLBACK,
} from "./constants";

export interface OtermSettings {
	defaultShell: string;
	shellArgs: string[];
	defaultCwd: "vault" | "home" | string;
	fontFamily: string;
	fontSize: number;
	scrollback: number;
	cursorStyle: "block" | "underline" | "bar";
	cursorBlink: boolean;
	useWebGL: boolean;
	copyOnSelect: boolean;
	openLocation: "bottom" | "right" | "tab";
}

export const DEFAULT_SETTINGS: OtermSettings = {
	defaultShell: "auto",
	shellArgs: [],
	defaultCwd: "vault",
	fontFamily: DEFAULT_FONT_FAMILY,
	fontSize: DEFAULT_FONT_SIZE,
	scrollback: DEFAULT_SCROLLBACK,
	cursorStyle: "block",
	cursorBlink: true,
	useWebGL: true,
	copyOnSelect: false,
	openLocation: "right",
};
