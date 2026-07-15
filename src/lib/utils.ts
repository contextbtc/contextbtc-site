import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

export function formatUnixTimestamp(
	timestamp: number,
	showTime?: boolean,
	showDate: boolean = true,
	locale?: string
): string {
	const date = new Date(timestamp * 1000);
	const options: Intl.DateTimeFormatOptions = {};

	if (showDate) {
		options.dateStyle = 'medium';
	}

	if (showTime) {
		options.timeStyle = 'short';
	}

	return date.toLocaleString(locale, options);
}

export function formatRelativeTime(value: Date | string): string {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) {
		return '';
	}

	const deltaSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
	if (deltaSeconds < 20) {
		return 'just now';
	}
	if (deltaSeconds < 60) {
		return `${deltaSeconds}s ago`;
	}

	const deltaMinutes = Math.floor(deltaSeconds / 60);
	if (deltaMinutes < 60) {
		return `${deltaMinutes}m ago`;
	}

	const deltaHours = Math.floor(deltaMinutes / 60);
	if (deltaHours < 24) {
		return `${deltaHours}h ago`;
	}

	const deltaDays = Math.floor(deltaHours / 24);
	if (deltaDays > 7) {
		return date.toLocaleDateString();
	}
	return `${deltaDays}d ago`;
}

export const isEmptyObj = (obj: object) => Object.keys(obj).length === 0;

/**
 * Slugify a string
 */
export function slugify(text: string): string {
	return text
		.toString()
		.toLowerCase()
		.trim()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/[\s-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Truncate a string to a specified length if it exceeds the limit
 */
export function truncateString(str: string, limit: number = 164): string {
	return str.length > limit ? str.slice(0, limit) + '...' : str;
}
