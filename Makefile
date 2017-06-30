deploy:
	git add .
	git commit -m'something'
	git push
	git push heroku master
	heroku config:set `./.env`
	heroku logs -t
