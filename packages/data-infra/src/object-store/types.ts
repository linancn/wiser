import type {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';

export type S3AuthorityCommand =
  | AbortMultipartUploadCommand
  | CompleteMultipartUploadCommand
  | CopyObjectCommand
  | CreateMultipartUploadCommand
  | DeleteObjectCommand
  | GetObjectCommand
  | HeadObjectCommand
  | PutObjectCommand
  | UploadPartCommand;

export interface S3AuthorityCommandClient {
  send(command: S3AuthorityCommand): Promise<unknown>;
}

export type S3AuthorityPresigner = (
  command: PutObjectCommand | UploadPartCommand | GetObjectCommand,
  expiresIn: number,
) => Promise<string>;

export interface AuthorityObjectInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly uploadId: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly contentType: string;
}

export interface AuthorityObjectLocation {
  readonly bucket: string;
  readonly key: string;
}

export interface QuarantinePutPlan extends AuthorityObjectLocation {
  readonly kind: 'single';
  readonly url: string;
  readonly expiresAt: string;
  readonly requiredHeaders: Readonly<Record<string, string>>;
}

export interface MultipartPartPlan {
  readonly partNumber: number;
  readonly sizeBytes: number;
  readonly url: string;
  readonly expiresAt: string;
}

export interface QuarantineMultipartPlan extends AuthorityObjectLocation {
  readonly kind: 'multipart';
  readonly uploadId: string;
  readonly parts: readonly MultipartPartPlan[];
}

export interface VersionDownloadPlan extends AuthorityObjectLocation {
  readonly url: string;
  readonly expiresAt: string;
}

export interface CommittedObjectLocations {
  readonly raw: AuthorityObjectLocation;
  readonly version: AuthorityObjectLocation;
  readonly reused: {
    readonly raw: boolean;
    readonly version: boolean;
  };
}

export interface S3AuthorityObjectStore {
  planQuarantinePut(
    input: AuthorityObjectInput & { readonly ttlSeconds: number },
  ): Promise<QuarantinePutPlan>;
  planQuarantineMultipart(
    input: AuthorityObjectInput & {
      readonly partSizeBytes: number;
      readonly ttlSeconds: number;
    },
  ): Promise<QuarantineMultipartPlan>;
  planVersionDownload(input: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly versionId: string;
    readonly sha256: string;
    readonly ttlSeconds: number;
  }): Promise<VersionDownloadPlan>;
  completeQuarantineMultipart(
    input: AuthorityObjectInput & {
      readonly multipartUploadId: string;
      readonly parts: readonly {
        readonly partNumber: number;
        readonly etag: string;
      }[];
    },
  ): Promise<void>;
  verifyQuarantineObject(input: AuthorityObjectInput): Promise<void>;
  commitQuarantineObject(
    input: AuthorityObjectInput & { readonly versionId: string },
  ): Promise<CommittedObjectLocations>;
  abortQuarantineObject(
    input: AuthorityObjectInput & { readonly multipartUploadId?: string },
  ): Promise<void>;
}
