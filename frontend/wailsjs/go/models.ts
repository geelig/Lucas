export namespace main {
	
	export class OutputView {
	    data: string;
	    sequence: number;
	
	    static createFrom(source: any = {}) {
	        return new OutputView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data = source["data"];
	        this.sequence = source["sequence"];
	    }
	}
	export class Snapshot {
	    groups: store.Group[];
	    profiles: store.Profile[];
	    groupOrder: string[];
	    sessions: session.Info[];
	
	    static createFrom(source: any = {}) {
	        return new Snapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groups = this.convertValues(source["groups"], store.Group);
	        this.profiles = this.convertValues(source["profiles"], store.Profile);
	        this.groupOrder = source["groupOrder"];
	        this.sessions = this.convertValues(source["sessions"], session.Info);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace session {
	
	export class Entry {
	    name: string;
	    path: string;
	    size: number;
	    isDir: boolean;
	    symlink: boolean;
	    // Go type: time
	    modified: any;
	    permissions?: string;
	    owner?: string;
	    group?: string;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.isDir = source["isDir"];
	        this.symlink = source["symlink"];
	        this.modified = this.convertValues(source["modified"], null);
	        this.permissions = source["permissions"];
	        this.owner = source["owner"];
	        this.group = source["group"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Info {
	    id: string;
	    profileId?: string;
	    name: string;
	    protocol: string;
	    address?: string;
	    state: string;
	    supportsFiles: boolean;
	    recording: boolean;
	    recordingPath?: string;
	    // Go type: time
	    openedAt: any;
	    cwd?: string;
	    os?: string;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.profileId = source["profileId"];
	        this.name = source["name"];
	        this.protocol = source["protocol"];
	        this.address = source["address"];
	        this.state = source["state"];
	        this.supportsFiles = source["supportsFiles"];
	        this.recording = source["recording"];
	        this.recordingPath = source["recordingPath"];
	        this.openedAt = this.convertValues(source["openedAt"], null);
	        this.cwd = source["cwd"];
	        this.os = source["os"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Listing {
	    path: string;
	    entries: Entry[];
	
	    static createFrom(source: any = {}) {
	        return new Listing(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.entries = this.convertValues(source["entries"], Entry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProcessInfo {
	    pid: number;
	    user: string;
	    cpu: number;
	    memory: number;
	    memoryBytes: number;
	    command: string;
	
	    static createFrom(source: any = {}) {
	        return new ProcessInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pid = source["pid"];
	        this.user = source["user"];
	        this.cpu = source["cpu"];
	        this.memory = source["memory"];
	        this.memoryBytes = source["memoryBytes"];
	        this.command = source["command"];
	    }
	}
	export class Metrics {
	    user: string;
	    ip: string;
	    cpuPercent: number;
	    memoryTotal: number;
	    memoryUsed: number;
	    memoryPercent: number;
	    rxPerSecond: number;
	    txPerSecond: number;
	    processes: ProcessInfo[];
	
	    static createFrom(source: any = {}) {
	        return new Metrics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.user = source["user"];
	        this.ip = source["ip"];
	        this.cpuPercent = source["cpuPercent"];
	        this.memoryTotal = source["memoryTotal"];
	        this.memoryUsed = source["memoryUsed"];
	        this.memoryPercent = source["memoryPercent"];
	        this.rxPerSecond = source["rxPerSecond"];
	        this.txPerSecond = source["txPerSecond"];
	        this.processes = this.convertValues(source["processes"], ProcessInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace store {
	
	export class Group {
	    id: string;
	    name: string;
	    parentId?: string;
	    order: number;
	
	    static createFrom(source: any = {}) {
	        return new Group(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.parentId = source["parentId"];
	        this.order = source["order"];
	    }
	}
	export class Profile {
	    id: string;
	    name: string;
	    protocol: string;
	    groupId?: string;
	    host?: string;
	    port?: number;
	    username?: string;
	    auth?: string;
	    password?: string;
	    privateKeyPath?: string;
	    passphrase?: string;
	    serialPort?: string;
	    baudRate?: number;
	    dataBits?: number;
	    stopBits?: number;
	    parity?: string;
	    flowControl?: string;
	    shell?: string;
	    directory?: string;
	    jumpProfileId?: string;
	    encoding?: string;
	    color?: string;
	    os?: string;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new Profile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.protocol = source["protocol"];
	        this.groupId = source["groupId"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.auth = source["auth"];
	        this.password = source["password"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.passphrase = source["passphrase"];
	        this.serialPort = source["serialPort"];
	        this.baudRate = source["baudRate"];
	        this.dataBits = source["dataBits"];
	        this.stopBits = source["stopBits"];
	        this.parity = source["parity"];
	        this.flowControl = source["flowControl"];
	        this.shell = source["shell"];
	        this.directory = source["directory"];
	        this.jumpProfileId = source["jumpProfileId"];
	        this.encoding = source["encoding"];
	        this.color = source["color"];
	        this.os = source["os"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

