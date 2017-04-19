var shell = require('shelljs');

shell.cd('antidote');

console.log("Erasing all antidote node\n");
shell.exec('./bin/stop-nodes.sh');
shell.rm('-rf', '_build/default/rel/antidote');

console.log("Launch 3 Antidote nodes and link them\n");
shell.exec('./bin/build-releases.sh 3');
shell.exec('./bin/launch-nodes.sh 3');
shell.exec('./bin/join_dcs_script.erl 'antidote1@127.0.0.1' 'antidote2@127.0.0.1' 'antidote3@127.0.0.1');

console.log("run S3\n")
shell.cd('../fork/S3');

shell.exec('npm run antidote_backend');

console.log("Create bucket-test ...\n");
shell.exec('s3cmd mb s3://bucket-test');

console.log("Add file test.txt ...\n");
shell.exec('s3cmd put test.txt s3://bucket-test/test.txt');

//bloquer la replication ? empecher la liaison ?

console.log("Latence de replication\n");
s3cmd setacl --acl-private s3://bucket-test/test.txt

console.log("Recuperation du fichier test.txt du site3, si ce n'est pas le site 3 qui gere\n");
s3cmd --host=127.0.0.1:8003 get s3://bucket-test/test.txt test2.txt

