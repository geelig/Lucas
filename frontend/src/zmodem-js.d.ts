declare module "zmodem.js/src/zsentry" {
  export interface ZmodemDetection {
    confirm(): ZmodemSession;
    deny(): void;
    get_session_role(): "receive" | "send";
  }

  export interface ZmodemOffer {
    accept(options?: { on_input?: "spool_uint8array" | "spool_array" | ((data: Uint8Array) => void) }): Promise<Uint8Array[]>;
    get_details(): {
      name: string;
      size?: number;
      mtime?: Date;
      mode?: number;
      files_remaining?: number;
      bytes_remaining?: number;
    };
    get_offset(): number;
    on(event: "input", callback: (data: Uint8Array) => void): this;
    skip(): void;
  }

  export interface ZmodemSession {
    type: "receive" | "send";
    abort(): void;
    consume(data: number[]): void;
    has_ended(): boolean;
    on(event: "offer", callback: (offer: ZmodemOffer) => void): this;
    on(event: string, callback: (...args: any[]) => void): this;
    set_sender(callback: (data: number[]) => void): this;
    start(): Promise<unknown>;
  }

  export interface ZmodemHeader {
    readonly NAME: string;
  }

  export class Sentry {
    constructor(options: {
      to_terminal(data: number[]): void;
      sender(data: number[]): void;
      on_detect(detection: ZmodemDetection): void;
      on_retract(): void;
    });
    consume(data: number[] | ArrayBuffer | Uint8Array): void;
    get_confirmed_session(): ZmodemSession | null;
  }

  export const Header: {
    build(name: string, ...args: any[]): { to_hex(): number[] };
    parse(data: number[]): [ZmodemHeader, 16 | 32] | undefined;
  };

  export const Session: {
    Send: new (header: ZmodemHeader) => ZmodemSession & {
      close(): Promise<void>;
      send_offer(details: { name: string; size?: number }): Promise<{
        end(data?: Uint8Array): Promise<void>;
      } | undefined>;
    };
  };

  const Zmodem: {
    Header: typeof Header;
    Sentry: typeof Sentry;
    Session: typeof Session;
  };

  export default Zmodem;
}
