import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react'
import type { MigrationState, DetectedService, MigrationRepository } from '../types/migration'
import type { ValidationResult } from '../types/api'
import { INITIAL_MIGRATION_STATE } from '../types/migration'

type MigrationAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_REPOSITORY'; payload: MigrationRepository }
  | { type: 'SET_STEP'; payload: MigrationState['step'] }
  | { type: 'SET_DETECTED_SERVICES'; payload: DetectedService[] }
  | { type: 'SET_FETCHED_CONFIGS'; payload: Record<string, string> }
  | {
      type: 'SET_CONVERSION_RESULT'
      payload: {
        convertedConfig: string
        validation?: ValidationResult
        attempts: number
        providerUsed?: string
        modelUsed?: string
      } | undefined
    }
  | { type: 'SET_EDITED_YAML'; payload: string }
  | { type: 'SET_ERROR'; payload: string | undefined }
  | { type: 'RESET' }

function migrationReducer(state: MigrationState, action: MigrationAction): MigrationState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload }
    case 'SET_REPOSITORY':
      return { ...state, repository: action.payload }
    case 'SET_STEP':
      return { ...state, step: action.payload }
    case 'SET_DETECTED_SERVICES':
      return { ...state, detectedServices: action.payload }
    case 'SET_FETCHED_CONFIGS':
      return { ...state, fetchedConfigs: action.payload }
    case 'SET_CONVERSION_RESULT':
      return {
        ...state,
        conversionResult: action.payload,
        editedYaml: action.payload?.convertedConfig || '',
      }
    case 'SET_EDITED_YAML':
      return { ...state, editedYaml: action.payload }
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false }
    case 'RESET':
      return INITIAL_MIGRATION_STATE
    default:
      return state
  }
}

interface MigrationContextType {
  state: MigrationState
  setLoading: (loading: boolean) => void
  setRepository: (repo: MigrationRepository) => void
  setStep: (step: MigrationState['step']) => void
  setDetectedServices: (services: DetectedService[]) => void
  setFetchedConfigs: (configs: Record<string, string>) => void
  setConversionResult: (result: {
    convertedConfig: string
    validation?: ValidationResult
    attempts: number
    providerUsed?: string
    modelUsed?: string
  } | undefined) => void
  setEditedYaml: (yaml: string) => void
  setError: (error: string | undefined) => void
  reset: () => void
}

const MigrationContext = createContext<MigrationContextType | undefined>(undefined)

export function MigrationProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(migrationReducer, INITIAL_MIGRATION_STATE)

  const setLoading = useCallback((loading: boolean) => {
    dispatch({ type: 'SET_LOADING', payload: loading })
  }, [])

  const setRepository = useCallback((repo: MigrationRepository) => {
    dispatch({ type: 'SET_REPOSITORY', payload: repo })
  }, [])

  const setStep = useCallback((step: MigrationState['step']) => {
    dispatch({ type: 'SET_STEP', payload: step })
  }, [])

  const setDetectedServices = useCallback((services: DetectedService[]) => {
    dispatch({ type: 'SET_DETECTED_SERVICES', payload: services })
  }, [])

  const setFetchedConfigs = useCallback((configs: Record<string, string>) => {
    dispatch({ type: 'SET_FETCHED_CONFIGS', payload: configs })
  }, [])

  const setConversionResult = useCallback(
    (result: { convertedConfig: string; validation?: ValidationResult; attempts: number; providerUsed?: string; modelUsed?: string } | undefined) => {
      dispatch({ type: 'SET_CONVERSION_RESULT', payload: result })
    },
    []
  )

  const setEditedYaml = useCallback((yaml: string) => {
    dispatch({ type: 'SET_EDITED_YAML', payload: yaml })
  }, [])

  const setError = useCallback((error: string | undefined) => {
    dispatch({ type: 'SET_ERROR', payload: error })
  }, [])

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' })
  }, [])

  return (
    <MigrationContext.Provider
      value={{
        state,
        setLoading,
        setRepository,
        setStep,
        setDetectedServices,
        setFetchedConfigs,
        setConversionResult,
        setEditedYaml,
        setError,
        reset,
      }}
    >
      {children}
    </MigrationContext.Provider>
  )
}

export function useMigration() {
  const context = useContext(MigrationContext)
  if (context === undefined) {
    throw new Error('useMigration must be used within a MigrationProvider')
  }
  return context
}
