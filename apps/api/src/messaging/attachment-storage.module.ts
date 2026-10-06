import { Module } from '@nestjs/common';
import { AttachmentService } from './attachment.service.js';
import { createAttachmentStorageProviderFromEnv } from './attachment-storage.js';

@Module({
  providers: [
    {
      provide: 'ATTACHMENT_STORAGE',
      useFactory: createAttachmentStorageProviderFromEnv,
    },
    {
      provide: AttachmentService,
      useFactory: (storage: ReturnType<typeof createAttachmentStorageProviderFromEnv>) =>
        new AttachmentService(storage),
      inject: ['ATTACHMENT_STORAGE'],
    },
  ],
  exports: [AttachmentService],
})
export class AttachmentStorageModule {}
