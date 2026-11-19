#!/usr/bin/env node

import { Context } from '@tbm-insight/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@tbm-insight/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@tbm-insight/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
