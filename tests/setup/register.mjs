// Loaded with `node --import ./tests/setup/register.mjs --test ...` (npm test).
import { register } from "node:module";

register("./ts-loader.mjs", import.meta.url);
