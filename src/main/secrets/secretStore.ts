import keytar from 'keytar';

const serviceName = 'kopaya';

export class SecretStore {
  async get(account: string): Promise<string | null> {
    return keytar.getPassword(serviceName, account);
  }

  async set(account: string, secret: string): Promise<void> {
    await keytar.setPassword(serviceName, account, secret);
  }

  async delete(account: string): Promise<boolean> {
    return keytar.deletePassword(serviceName, account);
  }
}
