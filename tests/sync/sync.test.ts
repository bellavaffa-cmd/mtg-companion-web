// Sync scenarios against a server without the compare-and-swap migration (the old push).
import { syncScenarios } from './scenarios.ts'

syncScenarios(false)
