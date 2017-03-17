import config from '../../Config';
import arsenal from 'arsenal';
import cluster from 'cluster';

class DataFileInterface extends arsenal.network.rest.Client {

    constructor() {
        const { host, port } = config.dataDaemon;

        super({ host, port, log: config.log });

        if (cluster.isMaster) {
            this.startServer();
        }
    }

    startServer() {
        this.server = new arsenal.network.rest.Server(
            { port: config.dataDaemon.port,
              dataStore: new arsenal.storage.data.file.Store(
                  { dataPath: config.dataDaemon.dataPath,
                    log: config.log }),
              log: config.log });
        this.server.setup(() => {
            this.server.start();
        });
    }

}

export default DataFileInterface;
