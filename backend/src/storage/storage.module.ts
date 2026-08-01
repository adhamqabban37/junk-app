import { Global, Module } from '@nestjs/common';
import { LocalFileStorage } from './local-file-storage';

@Global()
@Module({
  providers: [LocalFileStorage],
  exports: [LocalFileStorage],
})
export class StorageModule {}
