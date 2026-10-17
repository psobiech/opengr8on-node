export interface ProjectFeature {
    name: string;
    index: number;
    accessGet: boolean;
    accessSet: boolean;
    type: string;
}
export interface ProjectEvent {
    name: string;
    index: number;
}
export interface ProjectObject {
    name: string;
    nameOnClu: string;
    typeName: string;
    typeId: number;
    features: ProjectFeature[];
    events: ProjectEvent[];
    cluName: string;
}
export interface ProjectClu {
    id: string;
    name: string;
    nameOnClu: string;
    ipAddress: string;
    serialNumber?: string;
    macAddress?: string;
    objects: ProjectObject[];
}
export interface ProjectProperties {
    projectKey?: Buffer;
    projectIV?: Buffer;
    encryptedClus: Map<string, boolean>;
}
export declare class ProjectRegistry {
    private readonly _cluById;
    private readonly _cluByName;
    private readonly _properties;
    private constructor();
    static empty(): ProjectRegistry;
    /** Load from a project.omp ZIP file. Requires optional 'adm-zip' package. */
    static loadFromOmp(ompPath: string): Promise<ProjectRegistry>;
    /** Load from an already-extracted system.xml path. */
    static loadFromFile(systemXmlPath: string, propertiesXmlPath?: string): ProjectRegistry;
    static parseXml(systemXml: string, propertiesXml: string): ProjectRegistry;
    isEmpty(): boolean;
    getClus(): ProjectClu[];
    getClu(name: string): ProjectClu | null;
    getCluByIp(ip: string): ProjectClu | null;
    getObjectsForClu(cluName: string): ProjectObject[];
    getObjectOnClu(cluName: string, nameOnClu: string): ProjectObject | null;
    get properties(): ProjectProperties;
}
//# sourceMappingURL=ProjectRegistry.d.ts.map