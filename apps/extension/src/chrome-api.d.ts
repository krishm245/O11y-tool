declare namespace chrome {
  namespace offscreen {
    enum Reason {
      USER_MEDIA = "USER_MEDIA",
    }

    function hasDocument(): Promise<boolean>;
    function createDocument(options: {
      url: string;
      reasons: Reason[];
      justification: string;
    }): Promise<void>;
  }

  namespace runtime {
    function getURL(path: string): string;
  }

  namespace tabCapture {
    function getMediaStreamId(options: {
      targetTabId: number;
    }): Promise<string>;
  }
}
