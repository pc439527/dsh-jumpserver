import type { Classification } from './command-classifier.js';
/** Return null when the command is not a mysql/mariadb CLI invocation. */
export declare function classifyMysqlCli(command: string): Classification | null;
/** Return null when the command is not an `hdbsql` invocation. */
export declare function classifyHanaCli(command: string): Classification | null;
