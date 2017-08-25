all: commit deploy

commit:
	git add .
	git commit -m'something'

deploy:
	git push
	git push heroku master
	heroku config:set `./.env`
	heroku logs -t
