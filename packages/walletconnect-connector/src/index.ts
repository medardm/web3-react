import WalletConnectProvider from '@walletconnect/ethereum-provider'
import { AbstractConnector } from '@web3-react/abstract-connector'
import { ConnectorUpdate } from '@web3-react/types'
import {EthereumProviderOptions} from "@walletconnect/ethereum-provider/dist/types/EthereumProvider";

export const URI_AVAILABLE = 'URI_AVAILABLE'

export class UserRejectedRequestError extends Error {
  public constructor() {
    super()
    this.name = this.constructor.name
    this.message = 'The user rejected the request.'
  }
}

function getSupportedChains({ chains, rpcMap }: EthereumProviderOptions): number[] | undefined {
  if (chains) {
    return chains
  }

  return rpcMap ? Object.keys(rpcMap).map(k => Number(k)) : undefined
}

export class WalletConnectConnector extends AbstractConnector {
  public walletConnectProvider?: WalletConnectProvider
  private readonly config: EthereumProviderOptions

  constructor(config: EthereumProviderOptions) {
    super({ supportedChainIds: getSupportedChains(config) })
    this.config = config

    this.handleChainChanged = this.handleChainChanged.bind(this)
    this.handleAccountsChanged = this.handleAccountsChanged.bind(this)
    this.handleDisconnect = this.handleDisconnect.bind(this)
  }

  private handleChainChanged(chainId: number | string): void {
    if (__DEV__) {
      console.log("Handling 'chainChanged' event with payload", chainId)
    }
    this.emitUpdate({ chainId })
  }

  private handleAccountsChanged(accounts: string[]): void {
    if (__DEV__) {
      console.log("Handling 'accountsChanged' event with payload", accounts)
    }
    this.emitUpdate({ account: accounts[0] })
  }

  private handleDisconnect(): void {
    if (__DEV__) {
      console.log("Handling 'disconnect' event")
    }
    // we have to do this because of a @walletconnect/web3-provider bug
    if (this.walletConnectProvider) {
      this.walletConnectProvider.removeListener('chainChanged', this.handleChainChanged)
      this.walletConnectProvider.removeListener('accountsChanged', this.handleAccountsChanged)
      this.walletConnectProvider = undefined
    }
    this.emitDeactivate()
  }

  public async activate(): Promise<ConnectorUpdate> {
    if (!this.walletConnectProvider) {
      const WalletConnectProvider = await import('@walletconnect/ethereum-provider').then(m => m?.default ?? m)
      this.walletConnectProvider = await WalletConnectProvider.init(this.config)
    }

    // ensure that the uri is going to be available, and emit an event if there's a new uri
    if (!this.walletConnectProvider.connected) {
      await this.walletConnectProvider.connect(
        this.config.chains.length > 0 ? { chains: this.config.chains } : undefined
      )
      this.emit(URI_AVAILABLE, this.walletConnectProvider?.connected)
    }

    let account: string
    account = await new Promise<string>((resolve, reject) => {
      const userReject = () => {
        // Erase the provider manually
        this.walletConnectProvider = undefined
        reject(new UserRejectedRequestError())
      }

      // Workaround to bubble up the error when user reject the connection
      this.walletConnectProvider!.on('disconnect', () => {
        // Check provider has not been enabled to prevent this event callback from being called in the future
        if (!account) {
          userReject()
        }
      })

      this.walletConnectProvider!.enable()
        .then((accounts: string[]) => resolve(accounts[0]))
        .catch((error: Error): void => {
          // TODO ideally this would be a better check
          if (error.message === 'User closed modal') {
            userReject()
            return
          }
          reject(error)
        })
    }).catch(err => {
      throw err
    })

    this.walletConnectProvider.on('disconnect', this.handleDisconnect)
    this.walletConnectProvider.on('chainChanged', this.handleChainChanged)
    this.walletConnectProvider.on('accountsChanged', this.handleAccountsChanged)

    return { provider: this.walletConnectProvider, account }
  }

  public async getProvider(): Promise<any> {
    return this.walletConnectProvider
  }

  public async getChainId(): Promise<number | string> {
    return Promise.resolve(this.walletConnectProvider!.chainId)
  }

  public async getAccount(): Promise<null | string> {
    return Promise.resolve(this.walletConnectProvider!.accounts).then((accounts: string[]): string => accounts[0])
  }

  public deactivate() {
    if (this.walletConnectProvider) {
      this.walletConnectProvider.removeListener('disconnect', this.handleDisconnect)
      this.walletConnectProvider.removeListener('chainChanged', this.handleChainChanged)
      this.walletConnectProvider.removeListener('accountsChanged', this.handleAccountsChanged)
      this.walletConnectProvider.disconnect()
    }
  }

  public async close() {
    this.emitDeactivate()
  }
}
